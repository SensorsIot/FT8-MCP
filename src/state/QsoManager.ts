/**
 * QsoManager - Single QSO hub for WSJT-X and external loggers
 *
 * Per FSD v3 §8:
 * - Receives QSO logged events from ChannelUdpManager
 * - Writes to local ADIF logbook file (mcp_logbook.adi)
 * - Maintains WorkedIndex in StateManager for duplicate detection
 * - Optional: forwards to external loggers (future)
 *
 * ADIF format: https://www.adif.org/
 * Uses minimal ADIF 3.1.0 format for compatibility.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { StateManager } from './StateManager';
import { QsoRecord, WorkedEntry, workedKey, frequencyToBand } from './types';

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
    '160m': '160m',
    '80m': '80m',
    '60m': '60m',
    '40m': '40m',
    '30m': '30m',
    '20m': '20m',
    '17m': '17m',
    '15m': '15m',
    '12m': '12m',
    '10m': '10m',
    '6m': '6m',
    '2m': '2m',
    '70cm': '70cm',
};

export interface QsoManagerConfig {
    logbookPath?: string;      // Path to ADIF logbook file
    stationCallsign: string;   // Station callsign for STATION_CALLSIGN field
    stationGrid?: string;      // Station grid for MY_GRIDSQUARE field
    autoFlush?: boolean;       // Flush to disk after each QSO (default: true)
}

export class QsoManager extends EventEmitter {
    private stateManager: StateManager;
    private config: QsoManagerConfig;
    private logbookPath: string;
    private qsoCount: number = 0;
    private initialized: boolean = false;

    constructor(stateManager: StateManager, config: QsoManagerConfig) {
        super();
        this.stateManager = stateManager;
        this.config = {
            autoFlush: true,
            ...config,
        };

        // Default logbook path in user's home directory
        const defaultPath = path.join(
            process.env.APPDATA || process.env.HOME || '.',
            'wsjt-x-mcp',
            'mcp_logbook.adi'
        );
        this.logbookPath = config.logbookPath || defaultPath;
    }

    /**
     * Initialize the QSO manager
     * - Creates logbook directory if needed
     * - Loads existing ADIF file to populate WorkedIndex
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure directory exists
            const dir = path.dirname(this.logbookPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`[QsoManager] Created logbook directory: ${dir}`);
            }

            // Load existing logbook if present
            if (fs.existsSync(this.logbookPath)) {
                await this.loadAdifFile();
            } else {
                // Create new logbook with header
                this.createNewLogbook();
            }

            this.initialized = true;
            console.log(`[QsoManager] Initialized with ${this.qsoCount} existing QSOs`);
        } catch (error) {
            console.error(`[QsoManager] Failed to initialize:`, error);
            throw error;
        }
    }

    /**
     * Log a QSO (called when ChannelUdpManager emits qso-logged)
     */
    public logQso(qso: QsoRecord): void {
        if (!this.initialized) {
            console.warn('[QsoManager] Not initialized, QSO not logged to file');
            return;
        }

        try {
            // Write ADIF record to file
            const adifRecord = this.formatAdifRecord(qso);
            fs.appendFileSync(this.logbookPath, adifRecord);
            this.qsoCount++;

            console.log(`[QsoManager] Logged QSO #${this.qsoCount}: ${qso.call} on ${qso.band} ${qso.mode}`);

            // Emit for external listeners (future: forward to external loggers)
            this.emit('qso-written', qso);
        } catch (error) {
            console.error(`[QsoManager] Failed to write QSO:`, error);
            this.emit('error', { type: 'write-error', error, qso });
        }
    }

    /**
     * Get logbook path
     */
    public getLogbookPath(): string {
        return this.logbookPath;
    }

    /**
     * Get QSO count
     */
    public getQsoCount(): number {
        return this.qsoCount;
    }

    /**
     * Force flush to disk (if using buffered writes)
     */
    public flush(): void {
        // Currently writes are synchronous, but this is here for future async support
    }

    // === Private Methods ===

    /**
     * Create a new logbook file with ADIF header
     */
    private createNewLogbook(): void {
        const header = this.formatAdifHeader();
        fs.writeFileSync(this.logbookPath, header);
        console.log(`[QsoManager] Created new logbook: ${this.logbookPath}`);
    }

    /**
     * Format ADIF file header
     */
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

    /**
     * Format a single ADIF record
     */
    private formatAdifRecord(qso: QsoRecord): string {
        const fields: string[] = [];

        // Required fields
        fields.push(this.adifField(ADIF_FIELDS.CALL, qso.call));
        fields.push(this.adifField(ADIF_FIELDS.QSO_DATE, this.formatAdifDate(qso.timestamp_end)));
        fields.push(this.adifField(ADIF_FIELDS.TIME_ON, this.formatAdifTime(qso.timestamp_start)));
        fields.push(this.adifField(ADIF_FIELDS.TIME_OFF, this.formatAdifTime(qso.timestamp_end)));
        fields.push(this.adifField(ADIF_FIELDS.BAND, BAND_TO_ADIF[qso.band] || qso.band));
        fields.push(this.adifField(ADIF_FIELDS.FREQ, (qso.freq_hz / 1_000_000).toFixed(6)));
        fields.push(this.adifField(ADIF_FIELDS.MODE, qso.mode));

        // Optional fields
        if (qso.rst_sent) {
            fields.push(this.adifField(ADIF_FIELDS.RST_SENT, qso.rst_sent));
        }
        if (qso.rst_recv) {
            fields.push(this.adifField(ADIF_FIELDS.RST_RCVD, qso.rst_recv));
        }
        if (qso.grid) {
            fields.push(this.adifField(ADIF_FIELDS.GRIDSQUARE, qso.grid));
        }
        if (qso.tx_power_w) {
            fields.push(this.adifField(ADIF_FIELDS.TX_PWR, qso.tx_power_w.toString()));
        }
        if (qso.notes) {
            fields.push(this.adifField(ADIF_FIELDS.COMMENT, qso.notes));
        }

        // Station fields
        if (this.config.stationCallsign) {
            fields.push(this.adifField(ADIF_FIELDS.STATION_CALLSIGN, this.config.stationCallsign));
        }
        if (this.config.stationGrid) {
            fields.push(this.adifField(ADIF_FIELDS.MY_GRIDSQUARE, this.config.stationGrid));
        }

        // End of record
        fields.push('<EOR>');

        return fields.join('') + '\n';
    }

    /**
     * Format a single ADIF field
     */
    private adifField(name: string, value: string): string {
        return `<${name}:${value.length}>${value}`;
    }

    /**
     * Format ISO date to ADIF date (YYYYMMDD)
     */
    private formatAdifDate(isoDate: string): string {
        const date = new Date(isoDate);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Format ISO date to ADIF time (HHMMSS)
     */
    private formatAdifTime(isoDate: string): string {
        const date = new Date(isoDate);
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${hours}${minutes}${seconds}`;
    }

    /**
     * Format ISO date to ADIF timestamp (YYYYMMDD HHMMSS)
     */
    private formatAdifTimestamp(isoDate: string): string {
        return `${this.formatAdifDate(isoDate)} ${this.formatAdifTime(isoDate)}`;
    }

    /**
     * Load existing ADIF file and populate WorkedIndex
     */
    private async loadAdifFile(): Promise<void> {
        try {
            const content = fs.readFileSync(this.logbookPath, 'utf-8');
            const workedEntries = this.parseAdifFile(content);

            // Load into StateManager
            this.stateManager.loadWorkedIndex(workedEntries);
            this.qsoCount = workedEntries.length;

            console.log(`[QsoManager] Loaded ${workedEntries.length} QSOs from ${this.logbookPath}`);
        } catch (error) {
            console.error(`[QsoManager] Failed to load ADIF file:`, error);
            // Create a backup and start fresh
            const backupPath = `${this.logbookPath}.backup.${Date.now()}`;
            try {
                fs.copyFileSync(this.logbookPath, backupPath);
                console.log(`[QsoManager] Backed up corrupted logbook to ${backupPath}`);
            } catch {
                // Ignore backup errors
            }
            this.createNewLogbook();
        }
    }

    /**
     * Parse ADIF file content into WorkedEntry array
     */
    private parseAdifFile(content: string): WorkedEntry[] {
        const entries: WorkedEntry[] = [];

        // Find end of header
        const eohIndex = content.toUpperCase().indexOf('<EOH>');
        const dataStart = eohIndex >= 0 ? eohIndex + 5 : 0;
        const data = content.substring(dataStart);

        // Split by <EOR> to get individual records
        const records = data.split(/<EOR>/i).filter(r => r.trim());

        for (const record of records) {
            try {
                const call = this.extractAdifField(record, 'CALL');
                const band = this.extractAdifField(record, 'BAND');
                const mode = this.extractAdifField(record, 'MODE');
                const date = this.extractAdifField(record, 'QSO_DATE');
                const time = this.extractAdifField(record, 'TIME_OFF') ||
                             this.extractAdifField(record, 'TIME_ON');

                if (call && band && mode) {
                    // Normalize band (remove trailing 'm' if present to allow re-addition)
                    const normalizedBand = band.toLowerCase();

                    // Parse date/time to ISO format
                    let lastQsoTime = new Date().toISOString();
                    if (date && time) {
                        const year = date.substring(0, 4);
                        const month = date.substring(4, 6);
                        const day = date.substring(6, 8);
                        const hours = time.substring(0, 2);
                        const minutes = time.substring(2, 4);
                        const seconds = time.length >= 6 ? time.substring(4, 6) : '00';
                        lastQsoTime = new Date(
                            Date.UTC(
                                parseInt(year),
                                parseInt(month) - 1,
                                parseInt(day),
                                parseInt(hours),
                                parseInt(minutes),
                                parseInt(seconds)
                            )
                        ).toISOString();
                    }

                    entries.push({
                        call: call.toUpperCase(),
                        band: normalizedBand,
                        mode: mode.toUpperCase(),
                        last_qso_time: lastQsoTime,
                    });
                }
            } catch (error) {
                // Skip malformed records
                console.warn(`[QsoManager] Skipping malformed ADIF record`);
            }
        }

        return entries;
    }

    /**
     * Extract a field value from an ADIF record
     */
    private extractAdifField(record: string, fieldName: string): string | null {
        // ADIF format: <FIELDNAME:LENGTH>VALUE or <FIELDNAME:LENGTH:TYPE>VALUE
        const regex = new RegExp(`<${fieldName}:(\\d+)(?::[A-Z])?>(.*?)(?=<|$)`, 'i');
        const match = record.match(regex);

        if (match) {
            const length = parseInt(match[1]);
            const value = match[2];
            return value.substring(0, length);
        }

        return null;
    }

    /**
     * Export all QSOs to a new ADIF file
     */
    public exportToFile(outputPath: string): void {
        // This would require keeping all QSOs in memory or re-reading the file
        // For now, just copy the logbook
        fs.copyFileSync(this.logbookPath, outputPath);
        console.log(`[QsoManager] Exported logbook to ${outputPath}`);
    }

    /**
     * Clear the logbook (creates backup first)
     */
    public clearLogbook(): void {
        if (fs.existsSync(this.logbookPath)) {
            const backupPath = `${this.logbookPath}.backup.${Date.now()}`;
            fs.copyFileSync(this.logbookPath, backupPath);
            console.log(`[QsoManager] Backed up logbook to ${backupPath}`);
        }

        this.createNewLogbook();
        this.stateManager.clearWorkedIndex();
        this.qsoCount = 0;

        console.log(`[QsoManager] Logbook cleared`);
        this.emit('logbook-cleared');
    }
}
