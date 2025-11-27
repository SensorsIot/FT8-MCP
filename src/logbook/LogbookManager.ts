/**
 * LogbookManager - Central logbook management for MCP
 *
 * Per FSD v3 §7, §8, §9:
 * - ADIF logbook read/write (mcp_logbook.adi)
 * - WorkedIndex for duplicate detection (call/band/mode)
 * - HRD server for external loggers (Log4OM, N1MM) on port 7800
 * - Import/export logbooks
 *
 * This is the single source of truth for logbook operations.
 * WSJT-X QSO events flow here via ChannelUdpManager.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { HrdCatServer } from '../cat/HrdCatServer';

// === Types ===

export interface QsoRecord {
    timestamp_start: string;  // ISO8601 UTC
    timestamp_end: string;    // ISO8601 UTC
    call: string;
    grid: string | null;
    band: string;             // e.g., "20m"
    freq_hz: number;
    mode: string;             // e.g., "FT8"
    rst_sent: string | null;
    rst_recv: string | null;
    tx_power_w: number | null;
    slice_id: string;
    channel_index: number;
    wsjtx_instance: string;
    notes: string | null;
}

export interface WorkedEntry {
    call: string;
    band: string;
    mode: string;
    last_qso_time: string;  // ISO8601
}

export interface LogbookManagerConfig {
    logbookPath?: string;      // Path to ADIF logbook file
    stationCallsign: string;   // Station callsign for STATION_CALLSIGN field
    stationGrid?: string;      // Station grid for MY_GRIDSQUARE field
    hrdPort?: number;          // HRD server port for external loggers (default: 7800)
    enableHrdServer?: boolean; // Enable HRD server (default: false)
}

// ADIF field names
const ADIF_FIELDS = {
    CALL: 'CALL',
    QSO_DATE: 'QSO_DATE',
    TIME_ON: 'TIME_ON',
    TIME_OFF: 'TIME_OFF',
    BAND: 'BAND',
    FREQ: 'FREQ',
    MODE: 'MODE',
    RST_SENT: 'RST_SENT',
    RST_RCVD: 'RST_RCVD',
    GRIDSQUARE: 'GRIDSQUARE',
    TX_PWR: 'TX_PWR',
    COMMENT: 'COMMENT',
    MY_GRIDSQUARE: 'MY_GRIDSQUARE',
    STATION_CALLSIGN: 'STATION_CALLSIGN',
};

// ADIF band names mapping
const BAND_TO_ADIF: Record<string, string> = {
    '160m': '160m', '80m': '80m', '60m': '60m', '40m': '40m',
    '30m': '30m', '20m': '20m', '17m': '17m', '15m': '15m',
    '12m': '12m', '10m': '10m', '6m': '6m', '2m': '2m', '70cm': '70cm',
};

// Frequency to band mapping
export function frequencyToBand(freqHz: number): string {
    const freqMHz = freqHz / 1_000_000;
    if (freqMHz >= 1.8 && freqMHz < 2.0) return '160m';
    if (freqMHz >= 3.5 && freqMHz < 4.0) return '80m';
    if (freqMHz >= 5.3 && freqMHz < 5.5) return '60m';
    if (freqMHz >= 7.0 && freqMHz < 7.3) return '40m';
    if (freqMHz >= 10.1 && freqMHz < 10.15) return '30m';
    if (freqMHz >= 14.0 && freqMHz < 14.35) return '20m';
    if (freqMHz >= 18.068 && freqMHz < 18.168) return '17m';
    if (freqMHz >= 21.0 && freqMHz < 21.45) return '15m';
    if (freqMHz >= 24.89 && freqMHz < 24.99) return '12m';
    if (freqMHz >= 28.0 && freqMHz < 29.7) return '10m';
    if (freqMHz >= 50.0 && freqMHz < 54.0) return '6m';
    if (freqMHz >= 144.0 && freqMHz < 148.0) return '2m';
    if (freqMHz >= 420.0 && freqMHz < 450.0) return '70cm';
    return 'unknown';
}

// === LogbookManager Class ===

export class LogbookManager extends EventEmitter {
    private config: LogbookManagerConfig;
    private logbookPath: string;
    private workedIndex: Map<string, WorkedEntry> = new Map();
    private qsoCount: number = 0;
    private initialized: boolean = false;
    private hrdServer: HrdCatServer | null = null;
    private currentFrequency: number = 14074000;
    private currentMode: string = 'FT8';

    constructor(config: LogbookManagerConfig) {
        super();
        this.config = {
            hrdPort: 7800,
            enableHrdServer: false,
            ...config,
        };

        // Default logbook path
        const defaultPath = path.join(
            process.env.APPDATA || process.env.HOME || '.',
            'wsjt-x-mcp',
            'mcp_logbook.adi'
        );
        this.logbookPath = config.logbookPath || defaultPath;
    }

    // === Initialization ===

    /**
     * Initialize the logbook manager
     * - Creates logbook directory if needed
     * - Loads existing ADIF file to populate WorkedIndex
     * - Starts HRD server if enabled
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure directory exists
            const dir = path.dirname(this.logbookPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[Logbook] Created directory: ${dir}`);
            }

            // Load existing logbook if present
            if (fs.existsSync(this.logbookPath)) {
                await this.loadAdifFile();
            } else {
                this.createNewLogbook();
            }

            // Start HRD server for external loggers
            if (this.config.enableHrdServer) {
                await this.startHrdServer();
            }

            this.initialized = true;
            console.log(`[Logbook] Initialized with ${this.qsoCount} QSOs`);
        } catch (error) {
            console.error(`[Logbook] Failed to initialize:`, error);
            throw error;
        }
    }

    // === QSO Logging ===

    /**
     * Log a QSO to the logbook
     * Called when WSJT-X reports a completed QSO
     */
    public logQso(qso: QsoRecord): void {
        if (!this.initialized) {
            console.warn('[Logbook] Not initialized, QSO not logged');
            return;
        }

        try {
            // Write ADIF record
            const adifRecord = this.formatAdifRecord(qso);
            fs.appendFileSync(this.logbookPath, adifRecord);
            this.qsoCount++;

            // Update WorkedIndex
            const key = this.workedKey(qso.call, qso.band, qso.mode);
            this.workedIndex.set(key, {
                call: qso.call.toUpperCase(),
                band: qso.band.toLowerCase(),
                mode: qso.mode.toUpperCase(),
                last_qso_time: qso.timestamp_end,
            });

            console.log(`[Logbook] Logged QSO #${this.qsoCount}: ${qso.call} on ${qso.band} ${qso.mode}`);

            // Update current frequency/mode for HRD server
            this.currentFrequency = qso.freq_hz;
            this.currentMode = qso.mode;
            if (this.hrdServer) {
                this.hrdServer.setFrequency(qso.freq_hz);
                this.hrdServer.setMode(qso.mode);
            }

            this.emit('qso-logged', qso);
        } catch (error) {
            console.error(`[Logbook] Failed to write QSO:`, error);
            this.emit('error', { type: 'write-error', error, qso });
        }
    }

    // === Duplicate Checking (WorkedIndex) ===

    /**
     * Check if a station is already worked on band/mode
     */
    public isWorked(call: string, band: string, mode: string): boolean {
        const key = this.workedKey(call, band, mode);
        return this.workedIndex.has(key);
    }

    /**
     * Check if a station is worked on any mode on a band
     */
    public isWorkedOnBand(call: string, band: string): boolean {
        const prefix = `${call.toUpperCase()}_${band.toLowerCase()}_`;
        for (const key of this.workedIndex.keys()) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    /**
     * Check if a station is worked anywhere
     */
    public isWorkedAnywhere(call: string): boolean {
        const prefix = `${call.toUpperCase()}_`;
        for (const key of this.workedIndex.keys()) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    /**
     * Get last QSO time for a station/band/mode
     */
    public getLastQsoTime(call: string, band: string, mode: string): string | null {
        const key = this.workedKey(call, band, mode);
        const entry = this.workedIndex.get(key);
        return entry?.last_qso_time || null;
    }

    /**
     * Get all worked entries (for API)
     */
    public getWorkedEntries(): WorkedEntry[] {
        return Array.from(this.workedIndex.values());
    }

    private workedKey(call: string, band: string, mode: string): string {
        return `${call.toUpperCase()}_${band.toLowerCase()}_${mode.toUpperCase()}`;
    }

    // === HRD Server for External Loggers ===

    /**
     * Start HRD server for external logging programs (Log4OM, N1MM, etc.)
     */
    private async startHrdServer(): Promise<void> {
        const port = this.config.hrdPort || 7800;

        this.hrdServer = new HrdCatServer({
            port,
            sliceIndex: 0,
            sliceLetter: 'LOG',
        });

        // Set initial state
        this.hrdServer.setFrequency(this.currentFrequency);
        this.hrdServer.setMode(this.currentMode);

        // Listen for frequency/mode changes from logger
        this.hrdServer.on('frequency-change', (idx: number, freq: number) => {
            console.log(`[Logbook] Logger requested frequency: ${(freq / 1e6).toFixed(6)} MHz`);
            this.currentFrequency = freq;
            this.emit('logger-frequency-change', freq);
        });

        this.hrdServer.on('mode-change', (idx: number, mode: string) => {
            console.log(`[Logbook] Logger requested mode: ${mode}`);
            this.currentMode = mode;
            this.emit('logger-mode-change', mode);
        });

        await this.hrdServer.start();
        console.log(`[Logbook] HRD server started on port ${port} for external loggers`);
    }

    /**
     * Update the frequency/mode shown to external loggers
     * Called when TX channel changes or frequency updates
     */
    public updateLoggerState(freqHz: number, mode: string): void {
        this.currentFrequency = freqHz;
        this.currentMode = mode;
        if (this.hrdServer) {
            this.hrdServer.setFrequency(freqHz);
            this.hrdServer.setMode(mode);
        }
    }

    // === Getters ===

    public getLogbookPath(): string {
        return this.logbookPath;
    }

    public getQsoCount(): number {
        return this.qsoCount;
    }

    public getWorkedCount(): number {
        return this.workedIndex.size;
    }

    // === Import/Export ===

    /**
     * Export logbook to a new ADIF file
     */
    public exportToFile(outputPath: string): void {
        fs.copyFileSync(this.logbookPath, outputPath);
        console.log(`[Logbook] Exported to ${outputPath}`);
    }

    /**
     * Import ADIF file into logbook (merges with existing)
     */
    public importFromFile(inputPath: string): number {
        if (!fs.existsSync(inputPath)) {
            throw new Error(`File not found: ${inputPath}`);
        }

        const content = fs.readFileSync(inputPath, 'utf-8');
        const entries = this.parseAdifContent(content);

        let imported = 0;
        for (const entry of entries) {
            const key = this.workedKey(entry.call, entry.band, entry.mode);
            if (!this.workedIndex.has(key)) {
                this.workedIndex.set(key, entry);
                imported++;
            }
        }

        console.log(`[Logbook] Imported ${imported} new entries from ${inputPath}`);
        return imported;
    }

    /**
     * Clear logbook (creates backup first)
     */
    public clearLogbook(): void {
        if (fs.existsSync(this.logbookPath)) {
            const backupPath = `${this.logbookPath}.backup.${Date.now()}`;
            fs.copyFileSync(this.logbookPath, backupPath);
            console.log(`[Logbook] Backed up to ${backupPath}`);
        }

        this.createNewLogbook();
        this.workedIndex.clear();
        this.qsoCount = 0;

        console.log(`[Logbook] Cleared`);
        this.emit('logbook-cleared');
    }

    // === Shutdown ===

    public stop(): void {
        if (this.hrdServer) {
            this.hrdServer.stop();
            this.hrdServer = null;
        }
        console.log('[Logbook] Stopped');
    }

    // === Private: ADIF Parsing/Formatting ===

    private createNewLogbook(): void {
        const header = this.formatAdifHeader();
        fs.writeFileSync(this.logbookPath, header);
        console.log(`[Logbook] Created new logbook: ${this.logbookPath}`);
    }

    private formatAdifHeader(): string {
        const now = new Date().toISOString();
        return [
            `ADIF Export from WSJT-X MCP`,
            `<ADIF_VER:5>3.1.0`,
            `<CREATED_TIMESTAMP:15>${this.formatAdifTimestamp(now)}`,
            `<PROGRAMID:10>wsjt-x-mcp`,
            `<PROGRAMVERSION:5>1.0.0`,
            `<EOH>`,
            ``,
        ].join('\n');
    }

    private formatAdifRecord(qso: QsoRecord): string {
        const fields: string[] = [];

        fields.push(this.adifField(ADIF_FIELDS.CALL, qso.call));
        fields.push(this.adifField(ADIF_FIELDS.QSO_DATE, this.formatAdifDate(qso.timestamp_end)));
        fields.push(this.adifField(ADIF_FIELDS.TIME_ON, this.formatAdifTime(qso.timestamp_start)));
        fields.push(this.adifField(ADIF_FIELDS.TIME_OFF, this.formatAdifTime(qso.timestamp_end)));
        fields.push(this.adifField(ADIF_FIELDS.BAND, BAND_TO_ADIF[qso.band] || qso.band));
        fields.push(this.adifField(ADIF_FIELDS.FREQ, (qso.freq_hz / 1_000_000).toFixed(6)));
        fields.push(this.adifField(ADIF_FIELDS.MODE, qso.mode));

        if (qso.rst_sent) fields.push(this.adifField(ADIF_FIELDS.RST_SENT, qso.rst_sent));
        if (qso.rst_recv) fields.push(this.adifField(ADIF_FIELDS.RST_RCVD, qso.rst_recv));
        if (qso.grid) fields.push(this.adifField(ADIF_FIELDS.GRIDSQUARE, qso.grid));
        if (qso.tx_power_w) fields.push(this.adifField(ADIF_FIELDS.TX_PWR, qso.tx_power_w.toString()));
        if (qso.notes) fields.push(this.adifField(ADIF_FIELDS.COMMENT, qso.notes));
        if (this.config.stationCallsign) fields.push(this.adifField(ADIF_FIELDS.STATION_CALLSIGN, this.config.stationCallsign));
        if (this.config.stationGrid) fields.push(this.adifField(ADIF_FIELDS.MY_GRIDSQUARE, this.config.stationGrid));

        fields.push('<EOR>');
        return fields.join('') + '\n';
    }

    private adifField(name: string, value: string): string {
        return `<${name}:${value.length}>${value}`;
    }

    private formatAdifDate(isoDate: string): string {
        const date = new Date(isoDate);
        return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
    }

    private formatAdifTime(isoDate: string): string {
        const date = new Date(isoDate);
        return `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}`;
    }

    private formatAdifTimestamp(isoDate: string): string {
        return `${this.formatAdifDate(isoDate)} ${this.formatAdifTime(isoDate)}`;
    }

    private async loadAdifFile(): Promise<void> {
        try {
            const content = fs.readFileSync(this.logbookPath, 'utf-8');
            const entries = this.parseAdifContent(content);

            for (const entry of entries) {
                const key = this.workedKey(entry.call, entry.band, entry.mode);
                this.workedIndex.set(key, entry);
            }
            this.qsoCount = entries.length;

            console.log(`[Logbook] Loaded ${entries.length} QSOs from ${this.logbookPath}`);
        } catch (error) {
            console.error(`[Logbook] Failed to load ADIF:`, error);
            const backupPath = `${this.logbookPath}.backup.${Date.now()}`;
            try {
                fs.copyFileSync(this.logbookPath, backupPath);
                console.log(`[Logbook] Backed up corrupted file to ${backupPath}`);
            } catch { /* ignore */ }
            this.createNewLogbook();
        }
    }

    private parseAdifContent(content: string): WorkedEntry[] {
        const entries: WorkedEntry[] = [];

        const eohIndex = content.toUpperCase().indexOf('<EOH>');
        const dataStart = eohIndex >= 0 ? eohIndex + 5 : 0;
        const data = content.substring(dataStart);

        const records = data.split(/<EOR>/i).filter(r => r.trim());

        for (const record of records) {
            try {
                const call = this.extractAdifField(record, 'CALL');
                const band = this.extractAdifField(record, 'BAND');
                const mode = this.extractAdifField(record, 'MODE');
                const date = this.extractAdifField(record, 'QSO_DATE');
                const time = this.extractAdifField(record, 'TIME_OFF') || this.extractAdifField(record, 'TIME_ON');

                if (call && band && mode) {
                    let lastQsoTime = new Date().toISOString();
                    if (date && time) {
                        const year = date.substring(0, 4);
                        const month = date.substring(4, 6);
                        const day = date.substring(6, 8);
                        const hours = time.substring(0, 2);
                        const minutes = time.substring(2, 4);
                        const seconds = time.length >= 6 ? time.substring(4, 6) : '00';
                        lastQsoTime = new Date(Date.UTC(
                            parseInt(year), parseInt(month) - 1, parseInt(day),
                            parseInt(hours), parseInt(minutes), parseInt(seconds)
                        )).toISOString();
                    }

                    entries.push({
                        call: call.toUpperCase(),
                        band: band.toLowerCase(),
                        mode: mode.toUpperCase(),
                        last_qso_time: lastQsoTime,
                    });
                }
            } catch {
                // Skip malformed records
            }
        }

        return entries;
    }

    private extractAdifField(record: string, fieldName: string): string | null {
        const regex = new RegExp(`<${fieldName}:(\\d+)(?::[A-Z])?>(.*?)(?=<|$)`, 'i');
        const match = record.match(regex);
        if (match) {
            const length = parseInt(match[1]);
            return match[2].substring(0, length);
        }
        return null;
    }
}
