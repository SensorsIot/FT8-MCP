/**
 * DashboardManager - Station tracking and dashboard state for web UI
 *
 * Per FSD v3:
 * - Tracks decoded stations per slice/channel
 * - Computes station status (worked, strong, weak, etc.)
 * - Provides real-time updates to web dashboard
 * - Handles station lifetime and cleanup
 *
 * This replaces the StationTracker from src/wsjtx/ for cleaner separation.
 */

import { EventEmitter } from 'events';
import { Config } from '../SettingsManager';
import { LogbookManager } from '../logbook';

// === Types ===

export type StationStatus = 'worked' | 'normal' | 'weak' | 'strong' | 'priority' | 'new_dxcc';

export interface TrackedStation {
    callsign: string;
    grid: string;
    snr: number;
    frequency: number;  // Audio offset
    mode: string;
    lastSeen: number;   // Timestamp
    firstSeen: number;  // Timestamp
    decodeCount: number;
    status: StationStatus;
    message: string;    // Last decoded message
}

export interface SliceState {
    id: string;
    name: string;
    band: string;
    mode: string;
    dialFrequency: number;
    stations: TrackedStation[];
    isTransmitting: boolean;
    txEnabled: boolean;
}

export interface WsjtxDecode {
    id: string;
    newDecode: boolean;
    time: number;
    snr: number;
    deltaTime: number;
    deltaFrequency: number;
    mode: string;
    message: string;
    lowConfidence: boolean;
    offAir: boolean;
}

export interface WsjtxStatus {
    id: string;
    dialFrequency: number;
    mode: string;
    dxCall: string;
    report: string;
    txMode: string;
    txEnabled: boolean;
    transmitting: boolean;
    decoding: boolean;
    rxDF: number;
    txDF: number;
}

export interface DashboardManagerConfig {
    stationLifetimeSeconds?: number;  // How long to show stations after last decode
    snrWeakThreshold?: number;        // SNR below this = weak
    snrStrongThreshold?: number;      // SNR above this = strong
    colors?: {
        worked?: string;
        normal?: string;
        weak?: string;
        strong?: string;
        priority?: string;
        new_dxcc?: string;
    };
}

// === Helpers ===

function extractCallsign(message: string): string | null {
    const parts = message.trim().split(/\s+/);

    // Skip CQ messages - extract the calling station
    if (parts[0] === 'CQ') {
        if (parts.length >= 3) {
            const potentialCall = parts[1].length <= 3 ? parts[2] : parts[1];
            if (isValidCallsign(potentialCall)) {
                return potentialCall;
            }
        }
        return null;
    }

    // For other messages, first part is usually a callsign
    if (parts.length >= 1 && isValidCallsign(parts[0])) {
        return parts[0];
    }

    // Try second part
    if (parts.length >= 2 && isValidCallsign(parts[1])) {
        return parts[1];
    }

    return null;
}

function extractGrid(message: string): string {
    const parts = message.trim().split(/\s+/);
    const gridPattern = /^[A-R]{2}[0-9]{2}([a-x]{2})?$/i;

    for (const part of parts) {
        if (gridPattern.test(part)) {
            return part.toUpperCase();
        }
    }

    return '';
}

function isValidCallsign(str: string): boolean {
    if (!str || str.length < 3 || str.length > 10) return false;
    const callPattern = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(\/[A-Z0-9]+)?$/i;
    return callPattern.test(str);
}

function frequencyToBand(freqHz: number): string {
    const freqMhz = freqHz / 1_000_000;

    if (freqMhz >= 1.8 && freqMhz < 2.0) return '160m';
    if (freqMhz >= 3.5 && freqMhz < 4.0) return '80m';
    if (freqMhz >= 5.3 && freqMhz < 5.5) return '60m';
    if (freqMhz >= 7.0 && freqMhz < 7.3) return '40m';
    if (freqMhz >= 10.1 && freqMhz < 10.15) return '30m';
    if (freqMhz >= 14.0 && freqMhz < 14.35) return '20m';
    if (freqMhz >= 18.068 && freqMhz < 18.168) return '17m';
    if (freqMhz >= 21.0 && freqMhz < 21.45) return '15m';
    if (freqMhz >= 24.89 && freqMhz < 24.99) return '12m';
    if (freqMhz >= 28.0 && freqMhz < 29.7) return '10m';
    if (freqMhz >= 50.0 && freqMhz < 54.0) return '6m';
    if (freqMhz >= 144.0 && freqMhz < 148.0) return '2m';
    if (freqMhz >= 420.0 && freqMhz < 450.0) return '70cm';

    return `${freqMhz.toFixed(3)} MHz`;
}

// === Internal Types ===

interface SliceData {
    id: string;
    name: string;
    mode: string;
    dialFrequency: number;
    isTransmitting: boolean;
    txEnabled: boolean;
    stations: Map<string, TrackedStation>;
}

// === DashboardManager Class ===

export class DashboardManager extends EventEmitter {
    private config: DashboardManagerConfig;
    private slices: Map<string, SliceData> = new Map();
    private logbookManager: LogbookManager | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(config?: DashboardManagerConfig) {
        super();
        this.config = {
            stationLifetimeSeconds: 120,
            snrWeakThreshold: -15,
            snrStrongThreshold: 0,
            ...config,
        };

        // Start periodic cleanup of expired stations
        this.startCleanup();
    }

    /**
     * Set logbook manager for duplicate checking
     */
    public setLogbookManager(logbookManager: LogbookManager): void {
        this.logbookManager = logbookManager;
    }

    /**
     * Update configuration
     */
    public updateConfig(config: DashboardManagerConfig): void {
        this.config = { ...this.config, ...config };
    }

    // === Decode/Status Handling ===

    public handleDecode(decode: WsjtxDecode): void {
        const callsign = extractCallsign(decode.message);
        if (!callsign) return;

        // Get or create slice data
        let slice = this.slices.get(decode.id);
        if (!slice) {
            slice = {
                id: decode.id,
                name: decode.id,
                mode: decode.mode,
                dialFrequency: 0,
                isTransmitting: false,
                txEnabled: false,
                stations: new Map(),
            };
            this.slices.set(decode.id, slice);
        }

        // Update mode from decode
        slice.mode = decode.mode;

        const now = Date.now();
        const existing = slice.stations.get(callsign);

        // Compute station status
        const status = this.computeStatus(callsign, decode.snr, slice.dialFrequency, slice.mode);

        if (existing) {
            // Update existing station
            existing.snr = decode.snr;
            existing.frequency = decode.deltaFrequency;
            existing.lastSeen = now;
            existing.decodeCount++;
            existing.status = status;
            existing.message = decode.message;

            const grid = extractGrid(decode.message);
            if (grid) {
                existing.grid = grid;
            }
        } else {
            // Add new station
            const station: TrackedStation = {
                callsign,
                grid: extractGrid(decode.message),
                snr: decode.snr,
                frequency: decode.deltaFrequency,
                mode: decode.mode,
                lastSeen: now,
                firstSeen: now,
                decodeCount: 1,
                status,
                message: decode.message,
            };
            slice.stations.set(callsign, station);
        }

        this.emitUpdate();
    }

    public handleStatus(status: WsjtxStatus): void {
        let slice = this.slices.get(status.id);
        if (!slice) {
            slice = {
                id: status.id,
                name: status.id,
                mode: status.mode,
                dialFrequency: status.dialFrequency,
                isTransmitting: status.transmitting,
                txEnabled: status.txEnabled,
                stations: new Map(),
            };
            this.slices.set(status.id, slice);
        } else {
            slice.mode = status.mode;
            slice.dialFrequency = status.dialFrequency;
            slice.isTransmitting = status.transmitting;
            slice.txEnabled = status.txEnabled;
        }

        // Re-compute status for all stations when frequency changes
        for (const station of slice.stations.values()) {
            station.status = this.computeStatus(
                station.callsign,
                station.snr,
                slice.dialFrequency,
                slice.mode
            );
        }

        this.emitUpdate();
    }

    // === Status Computation ===

    private computeStatus(callsign: string, snr: number, dialFrequency: number, mode: string): StationStatus {
        // 1. Check if already worked
        const band = frequencyToBand(dialFrequency);
        if (this.logbookManager?.isWorked(callsign, band, mode)) {
            return 'worked';
        }

        // 2. Contest priority (placeholder)
        // TODO: Implement contest rules engine

        // 3. New DXCC (placeholder)
        // TODO: Implement DXCC lookup

        // 4. Signal strength
        if (snr >= (this.config.snrStrongThreshold ?? 0)) {
            return 'strong';
        }
        if (snr <= (this.config.snrWeakThreshold ?? -15)) {
            return 'weak';
        }

        // 5. Default
        return 'normal';
    }

    // === State Access ===

    public getSliceStates(): SliceState[] {
        const states: SliceState[] = [];

        for (const slice of this.slices.values()) {
            const stations = Array.from(slice.stations.values())
                .sort((a, b) => b.lastSeen - a.lastSeen);

            states.push({
                id: slice.id,
                name: slice.name,
                band: frequencyToBand(slice.dialFrequency),
                mode: slice.mode,
                dialFrequency: slice.dialFrequency,
                stations,
                isTransmitting: slice.isTransmitting,
                txEnabled: slice.txEnabled,
            });
        }

        return states;
    }

    public getStationCount(): number {
        let count = 0;
        for (const slice of this.slices.values()) {
            count += slice.stations.size;
        }
        return count;
    }

    public getColors(): Record<StationStatus, string> {
        return {
            worked: this.config.colors?.worked ?? '#6b7280',
            normal: this.config.colors?.normal ?? '#3b82f6',
            weak: this.config.colors?.weak ?? '#eab308',
            strong: this.config.colors?.strong ?? '#22c55e',
            priority: this.config.colors?.priority ?? '#f97316',
            new_dxcc: this.config.colors?.new_dxcc ?? '#ec4899',
        };
    }

    // === Cleanup ===

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredStations();
        }, 10000);
    }

    private cleanupExpiredStations(): void {
        const now = Date.now();
        const lifetimeMs = (this.config.stationLifetimeSeconds ?? 120) * 1000;
        let changed = false;

        for (const slice of this.slices.values()) {
            for (const [callsign, station] of slice.stations) {
                if (now - station.lastSeen > lifetimeMs) {
                    slice.stations.delete(callsign);
                    changed = true;
                }
            }
        }

        if (changed) {
            this.emitUpdate();
        }
    }

    private emitUpdate(): void {
        this.emit('update', this.getSliceStates());
    }

    // === Lifecycle ===

    public stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        console.log('[Dashboard] Stopped');
    }
}
