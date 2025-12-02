/**
 * StateManager - Single source of truth for MCP state
 *
 * Per FSD v3 §3, §11:
 * - Owns the canonical McpState object
 * - Receives updates from FlexClient, ChannelUdpManager, FlexRadioManager
 * - Exposes state via getState() for MCP tools and resources
 * - Emits 'state-changed' events for WebSocket push to dashboard
 *
 * This replaces the implicit state scattered across FlexClient,
 * FlexRadioManager, and StationTracker.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
    McpState,
    McpConfig,
    ChannelState,
    ChannelStatus,
    WsjtxInstanceState,
    LogbookIndex,
    InternalDecodeRecord,
    DecodeRecord,
    DecodesSnapshot,
    QsoRecord,
    WorkedEntry,
    frequencyToBand,
    indexToSliceLetter,
    createDefaultMcpState,
    createDefaultChannelState,
    workedKey,
} from './types';

// Heartbeat timeout - if no heartbeat in this time, mark channel disconnected
const HEARTBEAT_TIMEOUT_MS = 30000;

// Status update debounce to avoid flooding UI
const STATUS_DEBOUNCE_MS = 100;

// Maximum restart attempts before giving up (v7 FSD §12.4)
export const MAX_RESTART_ATTEMPTS = 5;

// Cooldown period before allowing restart after failure (prevent rapid restart loops)
const RESTART_COOLDOWN_MS = 5000;

export interface StateManagerConfig {
    callsign: string;
    grid: string;
    decodeHistoryMinutes?: number;
    stationLifetimeSeconds?: number;
}

export class StateManager extends EventEmitter {
    private state: McpState;
    private decodeBuffers: Map<number, InternalDecodeRecord[]> = new Map();
    private heartbeatCheckInterval: NodeJS.Timeout | null = null;
    private pendingUpdate: NodeJS.Timeout | null = null;

    constructor(config: StateManagerConfig) {
        super();
        this.state = createDefaultMcpState({
            callsign: config.callsign,
            grid: config.grid,
            decode_history_minutes: config.decodeHistoryMinutes ?? 15,
            station_lifetime_seconds: config.stationLifetimeSeconds ?? 120,
        });

        // Initialize decode buffers for all channels
        for (let i = 0; i < 4; i++) {
            this.decodeBuffers.set(i, []);
        }

        // Start heartbeat checker
        this.startHeartbeatChecker();
    }

    // === State Getters ===

    /**
     * Get full MCP state (for API/tools)
     */
    public getState(): McpState {
        return {
            ...this.state,
            logbook: {
                ...this.state.logbook,
                entries: new Map(this.state.logbook.entries),
            },
        };
    }

    /**
     * Get single channel state
     */
    public getChannel(index: number): ChannelState | null {
        if (index < 0 || index >= 4) return null;
        return { ...this.state.channels[index] };
    }

    /**
     * Get all channels (convenience method)
     */
    public getChannels(): ChannelState[] {
        return this.state.channels.map(ch => ({ ...ch }));
    }

    /**
     * Get TX channel
     */
    public getTxChannel(): ChannelState | null {
        if (this.state.tx_channel_index === null) return null;
        return this.getChannel(this.state.tx_channel_index);
    }

    /**
     * Get recent decodes for a channel (internal format)
     */
    public getDecodes(channelIndex: number, sinceMs?: number): InternalDecodeRecord[] {
        const buffer = this.decodeBuffers.get(channelIndex);
        if (!buffer) return [];

        if (sinceMs === undefined) {
            return [...buffer];
        }

        const cutoff = Date.now() - sinceMs;
        return buffer.filter(d => new Date(d.timestamp).getTime() >= cutoff);
    }

    /**
     * Get all recent decodes across all channels (internal format)
     */
    public getAllDecodes(sinceMs?: number): InternalDecodeRecord[] {
        const all: InternalDecodeRecord[] = [];
        for (let i = 0; i < 4; i++) {
            all.push(...this.getDecodes(i, sinceMs));
        }
        return all.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }

    /**
     * Check if a station is worked on band/mode
     */
    public isWorked(call: string, band: string, mode: string): boolean {
        const key = workedKey(call, band, mode);
        return this.state.logbook.entries.has(key);
    }

    /**
     * Get worked entry for a station
     */
    public getWorkedEntry(call: string, band: string, mode: string): WorkedEntry | null {
        const key = workedKey(call, band, mode);
        return this.state.logbook.entries.get(key) || null;
    }

    // === State Updaters (from external sources) ===

    /**
     * Update Flex connection status
     */
    public setFlexConnected(connected: boolean): void {
        if (this.state.flex_connected !== connected) {
            this.state.flex_connected = connected;
            console.log(`[StateManager] Flex connected: ${connected}`);
            this.scheduleUpdate();
        }
    }

    /**
     * Update channel from FlexRadio slice data
     */
    public updateFromFlex(
        sliceIndex: number,
        data: {
            freq_hz?: number;
            mode?: string;
            is_tx?: boolean;
            dax_rx?: number;
        }
    ): void {
        if (sliceIndex < 0 || sliceIndex >= 4) return;

        const channel = this.state.channels[sliceIndex];
        let changed = false;

        if (data.freq_hz !== undefined && channel.freq_hz !== data.freq_hz) {
            channel.freq_hz = data.freq_hz;
            channel.band = frequencyToBand(data.freq_hz);
            changed = true;
        }

        if (data.mode !== undefined && channel.mode !== data.mode) {
            channel.mode = data.mode;
            changed = true;
        }

        if (data.is_tx !== undefined && channel.is_tx !== data.is_tx) {
            // Update TX designation
            if (data.is_tx) {
                // Clear other channels' TX flag
                this.state.channels.forEach((ch, idx) => {
                    if (idx !== sliceIndex) ch.is_tx = false;
                });
                this.state.tx_channel_index = sliceIndex;
            }
            channel.is_tx = data.is_tx;
            changed = true;
        }

        if (data.dax_rx !== undefined && channel.dax_rx !== data.dax_rx) {
            channel.dax_rx = data.dax_rx;
            changed = true;
        }

        if (changed) {
            console.log(`[StateManager] Channel ${channel.id} updated from Flex: ${channel.band} ${channel.mode}`);
            this.scheduleUpdate();
        }
    }

    /**
     * Update channel from WSJT-X UDP Status message
     */
    public updateFromWsjtxStatus(
        channelIndex: number,
        data: {
            mode?: string;
            tx_enabled?: boolean;
            transmitting?: boolean;
            decoding?: boolean;
            rx_df?: number;
            tx_df?: number;
            dial_frequency?: number;
        }
    ): void {
        if (channelIndex < 0 || channelIndex >= 4) return;

        const channel = this.state.channels[channelIndex];
        let changed = false;

        if (data.mode !== undefined && channel.wsjtx_mode !== data.mode) {
            channel.wsjtx_mode = data.mode;
            changed = true;
        }

        if (data.tx_enabled !== undefined && channel.wsjtx_tx_enabled !== data.tx_enabled) {
            channel.wsjtx_tx_enabled = data.tx_enabled;
            changed = true;
        }

        if (data.transmitting !== undefined && channel.wsjtx_transmitting !== data.transmitting) {
            channel.wsjtx_transmitting = data.transmitting;
            // Update status based on transmitting
            if (data.transmitting && channel.status !== 'in_qso') {
                channel.status = 'calling';
            }
            changed = true;
        }

        if (data.decoding !== undefined && channel.wsjtx_decoding !== data.decoding) {
            channel.wsjtx_decoding = data.decoding;
            // Update status if decoding and idle
            if (data.decoding && channel.status === 'idle') {
                channel.status = 'decoding';
            }
            changed = true;
        }

        if (data.rx_df !== undefined) {
            channel.wsjtx_rx_df = data.rx_df;
        }

        if (data.tx_df !== undefined) {
            channel.wsjtx_tx_df = data.tx_df;
        }

        // Update frequency from WSJT-X if provided (in case of mismatch)
        if (data.dial_frequency !== undefined && channel.freq_hz !== data.dial_frequency) {
            channel.freq_hz = data.dial_frequency;
            channel.band = frequencyToBand(data.dial_frequency);
            changed = true;
        }

        if (changed) {
            this.scheduleUpdate();
        }
    }

    /**
     * Record heartbeat from WSJT-X instance
     */
    public recordHeartbeat(channelIndex: number): void {
        if (channelIndex < 0 || channelIndex >= 4) return;

        const channel = this.state.channels[channelIndex];
        const wasConnected = channel.connected;

        channel.connected = true;
        channel.last_heartbeat = Date.now();

        // Transition from offline to idle
        if (channel.status === 'offline') {
            channel.status = 'idle';
        }

        if (!wasConnected) {
            console.log(`[StateManager] Channel ${channel.id} connected (heartbeat received)`);
            this.scheduleUpdate();
        }
    }

    /**
     * Add a decode to the buffer and update state
     */
    public addDecode(decode: InternalDecodeRecord): void {
        const channelIndex = decode.channel_index;
        if (channelIndex < 0 || channelIndex >= 4) return;

        // Add to buffer
        const buffer = this.decodeBuffers.get(channelIndex)!;
        buffer.push(decode);

        // Evict old decodes
        const cutoffTime = Date.now() - (this.state.config.decode_history_minutes * 60 * 1000);
        while (buffer.length > 0 && new Date(buffer[0].timestamp).getTime() < cutoffTime) {
            buffer.shift();
        }

        // Update channel state
        const channel = this.state.channels[channelIndex];
        channel.decode_count++;
        channel.last_decode_time = decode.timestamp;

        if (channel.status === 'idle' || channel.status === 'offline') {
            channel.status = 'decoding';
        }

        // Emit decode event for immediate processing
        this.emit('decode', decode);
        this.scheduleUpdate();
    }

    /**
     * Record a logged QSO
     */
    public addQso(qso: QsoRecord): void {
        // Update worked index
        const key = workedKey(qso.call, qso.band, qso.mode);
        this.state.logbook.entries.set(key, {
            call: qso.call,
            band: qso.band,
            mode: qso.mode,
            last_qso_time: qso.timestamp_end,
        });
        this.state.logbook.total_qsos++;
        this.state.logbook.last_updated = qso.timestamp_end;

        // Update channel QSO count
        if (qso.channel_index >= 0 && qso.channel_index < 4) {
            this.state.channels[qso.channel_index].qso_count++;
        }

        console.log(`[StateManager] QSO logged: ${qso.call} on ${qso.band} ${qso.mode}`);
        this.emit('qso-logged', qso);
        this.scheduleUpdate();
    }

    /**
     * Set channel status manually
     */
    public setChannelStatus(channelIndex: number, status: ChannelStatus): void {
        if (channelIndex < 0 || channelIndex >= 4) return;

        const channel = this.state.channels[channelIndex];
        if (channel.status !== status) {
            channel.status = status;
            console.log(`[StateManager] Channel ${channel.id} status: ${status}`);
            this.scheduleUpdate();
        }
    }

    /**
     * Set TX channel
     */
    public setTxChannel(channelIndex: number): void {
        if (channelIndex < 0 || channelIndex >= 4) return;

        // Clear all TX flags
        this.state.channels.forEach(ch => {
            ch.is_tx = false;
        });

        // Set new TX channel
        this.state.channels[channelIndex].is_tx = true;
        this.state.tx_channel_index = channelIndex;

        console.log(`[StateManager] TX channel set to ${indexToSliceLetter(channelIndex)}`);
        this.scheduleUpdate();
    }

    // === WSJT-X Instance Management ===

    /**
     * Register a WSJT-X instance
     */
    public registerInstance(name: string, channelIndex: number): void {
        const existing = this.state.wsjtx_instances.find(i => i.name === name);
        if (existing) {
            existing.channel_index = channelIndex;
            existing.running = true;
            existing.last_start = Date.now();
            existing.error = null;
        } else {
            this.state.wsjtx_instances.push({
                name,
                channel_index: channelIndex,
                pid: null,
                running: true,
                restart_count: 0,
                last_start: Date.now(),
                error: null,
            });
        }

        // Update channel
        const channel = this.state.channels[channelIndex];
        channel.instanceName = name;
        channel.status = 'idle';

        console.log(`[StateManager] Instance ${name} registered for channel ${indexToSliceLetter(channelIndex)}`);
        this.scheduleUpdate();
    }

    /**
     * Update instance PID
     */
    public setInstancePid(name: string, pid: number): void {
        const instance = this.state.wsjtx_instances.find(i => i.name === name);
        if (instance) {
            instance.pid = pid;
        }
    }

    /**
     * Mark instance as stopped
     */
    public instanceStopped(name: string, error?: string): void {
        const instance = this.state.wsjtx_instances.find(i => i.name === name);
        if (instance) {
            instance.running = false;
            instance.pid = null;
            if (error) {
                instance.error = error;
                instance.restart_count++;
            }

            // Update channel
            const channel = this.state.channels[instance.channel_index];
            channel.connected = false;
            channel.status = error ? 'error' : 'offline';
        }

        console.log(`[StateManager] Instance ${name} stopped${error ? `: ${error}` : ''}`);
        this.scheduleUpdate();
    }

    /**
     * Unregister an instance completely
     */
    public unregisterInstance(name: string): void {
        const index = this.state.wsjtx_instances.findIndex(i => i.name === name);
        if (index >= 0) {
            const instance = this.state.wsjtx_instances[index];
            const channel = this.state.channels[instance.channel_index];
            channel.status = 'offline';
            channel.connected = false;

            this.state.wsjtx_instances.splice(index, 1);
            console.log(`[StateManager] Instance ${name} unregistered`);
            this.scheduleUpdate();
        }
    }

    // === Logbook Management ===

    /**
     * Load worked index from existing data
     */
    public loadWorkedIndex(entries: WorkedEntry[]): void {
        this.state.logbook.entries.clear();
        for (const entry of entries) {
            const key = workedKey(entry.call, entry.band, entry.mode);
            this.state.logbook.entries.set(key, entry);
        }
        this.state.logbook.total_qsos = entries.length;
        this.state.logbook.last_updated = new Date().toISOString();

        console.log(`[StateManager] Loaded ${entries.length} worked entries`);
        this.scheduleUpdate();
    }

    /**
     * Clear the worked index
     */
    public clearWorkedIndex(): void {
        this.state.logbook.entries.clear();
        this.state.logbook.total_qsos = 0;
        this.state.logbook.last_updated = null;
        this.scheduleUpdate();
    }

    /**
     * Assemble a DecodesSnapshot from all channels (v7 FSD §13.4)
     *
     * Converts internal decodes to MCP-facing format:
     * - Removes internal routing fields (channel_index, slice_id)
     * - Adds unique id field
     * - Wraps in snapshot with snapshot_id and generated_at
     *
     * @param sinceMs Optional time window in milliseconds
     * @returns DecodesSnapshot for MCP exposure
     */
    public getDecodesSnapshot(sinceMs?: number): DecodesSnapshot {
        const internalDecodes = this.getAllDecodes(sinceMs);

        // Convert InternalDecodeRecord → DecodeRecord
        const decodes: DecodeRecord[] = internalDecodes.map((internal, index) => {
            // Generate unique ID within this snapshot
            const id = `${internal.slice_id}-${internal.timestamp}-${index}`;

            // Create MCP-facing decode record (no internal routing fields)
            return {
                id,
                timestamp: internal.timestamp,
                band: internal.band,
                mode: internal.mode,
                dial_hz: internal.dial_hz,
                audio_offset_hz: internal.audio_offset_hz,
                rf_hz: internal.rf_hz,
                snr_db: internal.snr_db,
                dt_sec: internal.dt_sec,
                call: internal.call,
                grid: internal.grid,
                is_cq: internal.is_cq,
                is_my_call: internal.is_my_call,
                is_directed_cq_to_me: internal.is_directed_cq_to_me,
                cq_target_token: internal.cq_target_token,
                raw_text: internal.raw_text,
                is_new: internal.is_new,
                low_confidence: internal.low_confidence,
                off_air: internal.off_air,
            };
        });

        // Create snapshot with metadata
        return {
            snapshot_id: randomUUID(),
            generated_at: new Date().toISOString(),
            decodes,
        };
    }

    // === Internal Methods ===

    /**
     * Start periodic heartbeat checker (v7 FSD §12.4)
     * Monitors UDP heartbeats and triggers auto-restart when needed
     */
    private startHeartbeatChecker(): void {
        this.heartbeatCheckInterval = setInterval(() => {
            const now = Date.now();
            let changed = false;

            for (const channel of this.state.channels) {
                if (channel.connected && channel.last_heartbeat) {
                    if (now - channel.last_heartbeat > HEARTBEAT_TIMEOUT_MS) {
                        channel.connected = false;
                        channel.status = 'offline';
                        console.log(`[StateManager] Channel ${channel.id} disconnected (heartbeat timeout)`);
                        changed = true;

                        // Check if associated instance should be auto-restarted
                        const instance = this.state.wsjtx_instances.find(
                            i => i.channel_index === channel.index
                        );

                        if (instance && instance.running) {
                            // Mark instance as stopped with error
                            instance.running = false;
                            instance.error = 'Heartbeat timeout';

                            // Check if we should attempt auto-restart
                            const timeSinceStart = now - (instance.last_start || 0);
                            if (
                                instance.restart_count < MAX_RESTART_ATTEMPTS &&
                                timeSinceStart > RESTART_COOLDOWN_MS
                            ) {
                                console.log(
                                    `[StateManager] Channel ${channel.id} needs restart ` +
                                    `(attempt ${instance.restart_count + 1}/${MAX_RESTART_ATTEMPTS})`
                                );

                                // Emit event for WsjtxManager to handle restart
                                this.emit('channel-needs-restart', {
                                    channelIndex: channel.index,
                                    instanceName: instance.name,
                                    restartCount: instance.restart_count,
                                });
                            } else if (instance.restart_count >= MAX_RESTART_ATTEMPTS) {
                                console.error(
                                    `[StateManager] Channel ${channel.id} exceeded MAX_RESTART_ATTEMPTS ` +
                                    `(${instance.restart_count}), giving up`
                                );
                                channel.status = 'error';
                                instance.error = `Max restart attempts exceeded (${MAX_RESTART_ATTEMPTS})`;
                            }
                        }
                    }
                }
            }

            if (changed) {
                this.scheduleUpdate();
            }
        }, 5000);
    }

    /**
     * Schedule a state update (debounced)
     */
    private scheduleUpdate(): void {
        if (this.pendingUpdate) return;

        this.pendingUpdate = setTimeout(() => {
            this.pendingUpdate = null;
            this.emit('state-changed', this.getState());
        }, STATUS_DEBOUNCE_MS);
    }

    /**
     * Update config
     */
    public updateConfig(config: Partial<McpConfig>): void {
        this.state.config = { ...this.state.config, ...config };
        this.scheduleUpdate();
    }

    /**
     * Stop the state manager
     */
    public stop(): void {
        if (this.heartbeatCheckInterval) {
            clearInterval(this.heartbeatCheckInterval);
            this.heartbeatCheckInterval = null;
        }
        if (this.pendingUpdate) {
            clearTimeout(this.pendingUpdate);
            this.pendingUpdate = null;
        }
    }
}
