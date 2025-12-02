/**
 * State Types for MCP v3
 *
 * Per FSD v3 §3, §7, §8, §11:
 * - ChannelState: per-channel state object
 * - McpState: aggregate state for all channels
 * - DecodeRecord: parsed decode with channel context
 * - QsoRecord: logged QSO with full metadata
 * - WorkedEntry: logbook index entry for duplicate detection
 */

// Channel status enum per FSD §3.1
export type ChannelStatus = 'idle' | 'decoding' | 'calling' | 'in_qso' | 'error' | 'offline';

// Digital mode types
export type DigitalMode = 'FT8' | 'FT4' | 'JT65' | 'JT9' | 'WSPR';
export type RadioMode = 'DIGU' | 'USB' | 'LSB' | 'CW' | 'FM' | 'AM';

/**
 * Per-channel state object (FSD §3.1)
 */
export interface ChannelState {
    // Identity
    id: string;                     // "A", "B", "C", "D"
    index: number;                  // 0-3
    instanceName: string;           // "Slice-A", etc.

    // Radio state (from FlexRadio or virtual)
    freq_hz: number;                // Current dial frequency in Hz
    mode: string;                   // Radio mode: DIGU, USB, etc.
    band: string;                   // Derived: "20m", "40m", etc.

    // TX designation
    is_tx: boolean;                 // True if this is the TX slice

    // Audio routing
    dax_rx: number | null;          // DAX RX channel number (1-4)
    dax_tx: number | null;          // DAX TX channel (usually shared)

    // Network ports
    wsjtx_udp_port: number;         // UDP port for this instance (2237-2240)
    hrd_port: number;               // HRD CAT port for this instance (7809-7812)

    // WSJT-X state (from UDP Status messages)
    wsjtx_mode: string | null;      // FT8, FT4, etc.
    wsjtx_tx_enabled: boolean;      // TX enabled in WSJT-X
    wsjtx_transmitting: boolean;    // Currently transmitting
    wsjtx_decoding: boolean;        // Currently decoding
    wsjtx_rx_df: number;            // RX audio frequency offset
    wsjtx_tx_df: number;            // TX audio frequency offset

    // Status
    status: ChannelStatus;          // Current channel status
    connected: boolean;             // WSJT-X instance connected (heartbeats received)
    last_heartbeat: number | null;  // Timestamp of last heartbeat
    last_decode_time: string | null; // ISO8601 of last decode

    // Activity counters
    decode_count: number;           // Total decodes this session
    qso_count: number;              // Total QSOs this session
}

/**
 * WSJT-X instance state (FSD §6)
 */
export interface WsjtxInstanceState {
    name: string;                   // Instance name (rig name)
    channel_index: number;          // Associated channel (0-3)
    pid: number | null;             // Process ID if running
    running: boolean;               // Process is running
    restart_count: number;          // Number of restarts
    last_start: number | null;      // Timestamp of last start
    error: string | null;           // Last error message if any
}

/**
 * Logbook index for duplicate detection (FSD §7.4)
 */
export interface WorkedEntry {
    call: string;
    band: string;                   // "20m", "40m", etc.
    mode: string;                   // "FT8", "FT4"
    last_qso_time: string;          // ISO8601
}

/**
 * Logbook index aggregate
 */
export interface LogbookIndex {
    entries: Map<string, WorkedEntry>;  // Key: "CALL:BAND:MODE"
    total_qsos: number;
    last_updated: string | null;        // ISO8601
}

/**
 * Aggregate MCP state (FSD §3.1)
 */
export interface McpState {
    channels: ChannelState[];
    tx_channel_index: number | null;    // Which channel is TX (0-3 or null)
    flex_connected: boolean;
    wsjtx_instances: WsjtxInstanceState[];
    logbook: LogbookIndex;
    config: McpConfig;
}

/**
 * MCP configuration subset exposed in state
 */
export interface McpConfig {
    callsign: string;
    grid: string;
    decode_history_minutes: number;
    station_lifetime_seconds: number;
}

/**
 * Station profile for CQ targeting (v7 FSD §7)
 */
export interface StationProfile {
    my_call: string;
    my_continent: string;           // "EU", "NA", "SA", "AF", "AS", "OC", "AN"
    my_dxcc: string;                // e.g. "HB9"
    my_prefixes: string[];          // All known prefixes for this station
    // Optional: CQ zone, ITU zone, custom regions
}

/**
 * Internal decode record with channel routing info (v7 FSD §13.2)
 * This is used internally by MCP and includes channel/slice details.
 */
export interface InternalDecodeRecord {
    // Internal routing fields (not exposed to MCP clients)
    channel_index: number;          // 0-3
    slice_id: string;               // "A".."D"

    // Core decode data
    timestamp: string;              // ISO8601 UTC
    band: string;                   // e.g. "20m", "40m"
    mode: string;                   // FT8, FT4, etc.

    // Frequency info
    dial_hz: number;                // WSJT-X dial frequency
    audio_offset_hz: number;        // Delta frequency from decode
    rf_hz: number;                  // dial_hz + audio_offset_hz

    // Signal info
    snr_db: number;
    dt_sec: number;                 // Delta time

    // Parsed message
    call: string;                   // Non-null (filtered before creating)
    grid: string | null;
    is_cq: boolean;
    is_my_call: boolean;
    raw_text: string;

    // Enriched CQ targeting fields (computed by CQ targeting logic)
    is_directed_cq_to_me: boolean;  // Server-side decision
    cq_target_token: string | null; // "DX", "NA", "EU", "JA", etc.

    // Optional WSJT-X flags
    is_new?: boolean;               // WSJT-X "new" flag
    low_confidence?: boolean;       // WSJT-X lowConfidence flag
    off_air?: boolean;              // WSJT-X offAir flag
}

/**
 * MCP-facing decode record (v7 FSD §2.1)
 * This is the canonical type exposed via wsjt-x://decodes resource and events.
 * Derived from InternalDecodeRecord by dropping channel_index/slice_id and adding id.
 */
export interface DecodeRecord {
    id: string;                     // Unique within snapshot

    timestamp: string;              // ISO8601 UTC

    band: string;                   // e.g. "20m", "40m"
    mode: string;                   // FT8, FT4

    dial_hz: number;                // WSJT-X dial frequency
    audio_offset_hz: number;        // Audio offset (DF) in Hz
    rf_hz: number;                  // RF frequency (dial_hz + audio_offset_hz)

    snr_db: number;                 // SNR in dB
    dt_sec: number;                 // Timing offset in seconds

    call: string;                   // Decoded primary callsign
    grid: string | null;            // Maidenhead locator or null

    is_cq: boolean;                 // True if CQ-type message
    is_my_call: boolean;            // True if addressed to our callsign

    /**
     * True if THIS station is allowed to answer this CQ according to
     * CQ pattern (CQ DX, CQ NA, etc.) and operator's location.
     * Server is authoritative; client MUST NOT reimplement this logic.
     */
    is_directed_cq_to_me: boolean;

    /**
     * Raw CQ target token extracted from message (informational only).
     * Examples: "DX", "NA", "EU", "JA" or null for plain CQ.
     */
    cq_target_token: string | null;

    raw_text: string;               // Raw WSJT-X decoded message text

    // Optional WSJT-X flags
    is_new?: boolean;
    low_confidence?: boolean;
    off_air?: boolean;
}

/**
 * Snapshot of all current decodes (v7 FSD §2.2)
 * This is the canonical representation used in both:
 * - wsjt-x://decodes resource
 * - resources/updated event payload
 */
export interface DecodesSnapshot {
    snapshot_id: string;            // Unique ID for this snapshot (e.g. UUID)
    generated_at: string;           // ISO8601 UTC when snapshot was built
    decodes: DecodeRecord[];        // Full decode list exposed to client
}

/**
 * QSO record for logging (FSD §8.1)
 */
export interface QsoRecord {
    timestamp_start: string;        // ISO8601
    timestamp_end: string;          // ISO8601
    call: string;
    grid: string | null;
    band: string;
    freq_hz: number;
    mode: string;                   // FT8, FT4
    rst_sent: string | null;
    rst_recv: string | null;
    tx_power_w: number | null;
    slice_id: string;
    channel_index: number;
    wsjtx_instance: string;
    notes: string | null;

    // Exchange info (for contests, etc.)
    exchange_sent: string | null;
    exchange_recv: string | null;
}

/**
 * Helper: Convert frequency to band name
 */
export function frequencyToBand(freqHz: number): string {
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

    return 'unknown';
}

/**
 * Helper: Get slice letter from index
 */
export function indexToSliceLetter(index: number): string {
    return String.fromCharCode(65 + index);  // 0 -> "A", 1 -> "B", etc.
}

/**
 * Helper: Get index from slice letter
 */
export function sliceLetterToIndex(letter: string): number {
    return letter.toUpperCase().charCodeAt(0) - 65;  // "A" -> 0, "B" -> 1, etc.
}

/**
 * Helper: Create WorkedIndex key
 */
export function workedKey(call: string, band: string, mode: string): string {
    return `${call.toUpperCase()}:${band}:${mode.toUpperCase()}`;
}

/**
 * Helper: Create default channel state
 */
export function createDefaultChannelState(index: number): ChannelState {
    const id = indexToSliceLetter(index);
    return {
        id,
        index,
        instanceName: `Slice-${id}`,
        freq_hz: 0,
        mode: 'DIGU',
        band: 'unknown',
        is_tx: index === 0,  // Default: first channel is TX
        dax_rx: index + 1,
        dax_tx: 1,
        wsjtx_udp_port: 2237 + index,
        hrd_port: 7809 + index,
        wsjtx_mode: null,
        wsjtx_tx_enabled: false,
        wsjtx_transmitting: false,
        wsjtx_decoding: false,
        wsjtx_rx_df: 0,
        wsjtx_tx_df: 0,
        status: 'offline',
        connected: false,
        last_heartbeat: null,
        last_decode_time: null,
        decode_count: 0,
        qso_count: 0,
    };
}

/**
 * Helper: Create default MCP state
 */
export function createDefaultMcpState(config: McpConfig): McpState {
    return {
        channels: [0, 1, 2, 3].map(createDefaultChannelState),
        tx_channel_index: 0,
        flex_connected: false,
        wsjtx_instances: [],
        logbook: {
            entries: new Map(),
            total_qsos: 0,
            last_updated: null,
        },
        config,
    };
}
