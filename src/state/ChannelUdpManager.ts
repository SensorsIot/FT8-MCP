/**
 * ChannelUdpManager - Dynamic UDP listener management per channel
 *
 * Per FSD v3 §7:
 * - Manages UDP listeners for each active channel (ports 2237-2240)
 * - Creates/destroys listeners with slice lifecycle
 * - Parses Decode, Status, Heartbeat, and QSO Logged messages
 * - Forwards to StateManager with channel context
 *
 * This replaces the single WsjtxUdpListener with a multi-channel approach.
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';
import { StateManager } from './StateManager';
import {
    InternalDecodeRecord,
    QsoRecord,
    StationProfile,
    frequencyToBand,
    indexToSliceLetter,
} from './types';
import { enrichWithCqTargeting } from '../utils/CqTargeting';

// WSJT-X UDP Message Types
enum WsjtxMessageType {
    HEARTBEAT = 0,
    STATUS = 1,
    DECODE = 2,
    CLEAR = 3,
    REPLY = 4,
    QSO_LOGGED = 5,
    CLOSE = 6,
    REPLAY = 7,
    HALT_TX = 8,
    FREE_TEXT = 9,
    WSPR_DECODE = 10,
    LOCATION = 11,
    LOGGED_ADIF = 12,
    HIGHLIGHT_CALLSIGN = 13,
    SWITCH_CONFIGURATION = 14,
    CONFIGURE = 15,
}

// UDP port base
const UDP_BASE_PORT = 2237;

// Magic number for WSJT-X packets
const WSJT_MAGIC = 0xadbccbda;

interface ChannelListener {
    socket: dgram.Socket;
    port: number;
    channelIndex: number;
    instanceId: string;
}

export class ChannelUdpManager extends EventEmitter {
    private stateManager: StateManager;
    private udpListeners: Map<number, ChannelListener> = new Map();
    private myCallsign: string;
    private stationProfile: StationProfile;

    constructor(stateManager: StateManager, myCallsign: string, stationProfile: StationProfile) {
        super();
        this.stateManager = stateManager;
        this.myCallsign = myCallsign.toUpperCase();
        this.stationProfile = stationProfile;
    }

    /**
     * Start a UDP listener for a channel
     */
    public startChannel(channelIndex: number, instanceId: string): void {
        if (channelIndex < 0 || channelIndex >= 4) {
            throw new Error(`Invalid channel index: ${channelIndex}`);
        }

        if (this.udpListeners.has(channelIndex)) {
            console.log(`[ChannelUdpManager] Channel ${channelIndex} listener already running`);
            return;
        }

        const port = UDP_BASE_PORT + channelIndex;
        const socket = dgram.createSocket('udp4');

        socket.on('message', (msg, rinfo) => {
            try {
                this.parseMessage(channelIndex, instanceId, msg);
            } catch (error) {
                console.error(`[ChannelUdpManager] Error parsing message on channel ${channelIndex}:`, error);
            }
        });

        socket.on('error', (err) => {
            console.error(`[ChannelUdpManager] UDP socket error on channel ${channelIndex}:`, err);
            this.emit('error', { channelIndex, error: err });
        });

        socket.bind(port, () => {
            console.log(`[ChannelUdpManager] Channel ${indexToSliceLetter(channelIndex)} listening on UDP port ${port}`);
        });

        this.udpListeners.set(channelIndex, {
            socket,
            port,
            channelIndex,
            instanceId,
        });
    }

    /**
     * Stop a UDP listener for a channel
     */
    public stopChannel(channelIndex: number): void {
        const listener = this.udpListeners.get(channelIndex);
        if (listener) {
            listener.socket.close();
            this.udpListeners.delete(channelIndex);
            console.log(`[ChannelUdpManager] Channel ${indexToSliceLetter(channelIndex)} listener stopped`);
        }
    }

    /**
     * Stop all listeners
     */
    public stopAll(): void {
        for (const channelIndex of this.udpListeners.keys()) {
            this.stopChannel(channelIndex);
        }
    }

    /**
     * Update callsign (for is_my_call detection)
     */
    public setCallsign(callsign: string): void {
        this.myCallsign = callsign.toUpperCase();
    }

    /**
     * Get active channel indices
     */
    public getActiveChannels(): number[] {
        return Array.from(this.udpListeners.keys());
    }

    // === Message Parsing ===

    private parseMessage(channelIndex: number, instanceId: string, buffer: Buffer): void {
        let offset = 0;

        // Magic number (4 bytes)
        const magic = buffer.readUInt32BE(offset);
        offset += 4;
        if (magic !== WSJT_MAGIC) {
            console.warn(`[ChannelUdpManager] Invalid magic number on channel ${channelIndex}`);
            return;
        }

        // Schema version (4 bytes)
        const schema = buffer.readUInt32BE(offset);
        offset += 4;

        // Message type (4 bytes)
        const messageType = buffer.readUInt32BE(offset);
        offset += 4;

        // ID (QString)
        const { value: id, newOffset } = this.readQString(buffer, offset);
        offset = newOffset;

        switch (messageType) {
            case WsjtxMessageType.HEARTBEAT:
                this.handleHeartbeat(channelIndex, id);
                break;

            case WsjtxMessageType.STATUS:
                this.handleStatus(channelIndex, id, buffer, offset);
                break;

            case WsjtxMessageType.DECODE:
                this.handleDecode(channelIndex, id, buffer, offset);
                break;

            case WsjtxMessageType.QSO_LOGGED:
                this.handleQsoLogged(channelIndex, id, buffer, offset);
                break;

            case WsjtxMessageType.CLOSE:
                this.handleClose(channelIndex, id);
                break;

            default:
                // Ignore other message types
                break;
        }
    }

    private handleHeartbeat(channelIndex: number, id: string): void {
        this.stateManager.recordHeartbeat(channelIndex);
        this.emit('heartbeat', { channelIndex, id });
    }

    private handleStatus(channelIndex: number, id: string, buffer: Buffer, offset: number): void {
        try {
            // Dial frequency (quint64)
            const dialFrequency = Number(buffer.readBigUInt64BE(offset));
            offset += 8;

            // Mode (QString)
            const { value: mode, newOffset: offset2 } = this.readQString(buffer, offset);
            offset = offset2;

            // DX call (QString)
            const { value: dxCall, newOffset: offset3 } = this.readQString(buffer, offset);
            offset = offset3;

            // Report (QString)
            const { value: report, newOffset: offset4 } = this.readQString(buffer, offset);
            offset = offset4;

            // TX mode (QString)
            const { value: txMode, newOffset: offset5 } = this.readQString(buffer, offset);
            offset = offset5;

            // TX enabled (bool)
            const txEnabled = buffer.readUInt8(offset) !== 0;
            offset += 1;

            // Transmitting (bool)
            const transmitting = buffer.readUInt8(offset) !== 0;
            offset += 1;

            // Decoding (bool)
            const decoding = buffer.readUInt8(offset) !== 0;
            offset += 1;

            // RX DF (quint32)
            const rxDF = buffer.readUInt32BE(offset);
            offset += 4;

            // TX DF (quint32)
            const txDF = buffer.readUInt32BE(offset);
            offset += 4;

            // Update state manager
            this.stateManager.updateFromWsjtxStatus(channelIndex, {
                mode,
                tx_enabled: txEnabled,
                transmitting,
                decoding,
                rx_df: rxDF,
                tx_df: txDF,
                dial_frequency: dialFrequency,
            });

            // Also emit for other listeners
            this.emit('status', {
                channelIndex,
                id,
                dialFrequency,
                mode,
                dxCall,
                report,
                txMode,
                txEnabled,
                transmitting,
                decoding,
                rxDF,
                txDF,
            });
        } catch (error) {
            console.error(`[ChannelUdpManager] Error parsing status on channel ${channelIndex}:`, error);
        }
    }

    private handleDecode(channelIndex: number, id: string, buffer: Buffer, offset: number): void {
        try {
            // New (bool)
            const newDecode = buffer.readUInt8(offset) !== 0;
            offset += 1;

            // Time (quint32) - milliseconds since midnight UTC
            const time = buffer.readUInt32BE(offset);
            offset += 4;

            // SNR (qint32)
            const snr = buffer.readInt32BE(offset);
            offset += 4;

            // Delta time (float64)
            const deltaTime = buffer.readDoubleBE(offset);
            offset += 8;

            // Delta frequency (quint32)
            const deltaFrequency = buffer.readUInt32BE(offset);
            offset += 4;

            // Mode (QString)
            const { value: mode, newOffset: offset2 } = this.readQString(buffer, offset);
            offset = offset2;

            // Message (QString)
            const { value: message, newOffset: offset3 } = this.readQString(buffer, offset);
            offset = offset3;

            // Low confidence (bool)
            const lowConfidence = buffer.readUInt8(offset) !== 0;
            offset += 1;

            // Off air (bool)
            const offAir = buffer.readUInt8(offset) !== 0;

            // Get channel state for dial frequency
            const channel = this.stateManager.getChannel(channelIndex);
            const dialHz = channel?.freq_hz || 0;

            // Parse callsign and grid from message
            const { call, grid, isCq } = this.parseDecodeMessage(message);

            // Skip decodes with no valid callsign
            if (!call) {
                return;
            }

            // Check if message is for us
            const isMyCall = this.isMessageForMe(message);

            // Derive band from dial frequency
            const band = frequencyToBand(dialHz);

            // Enrich with CQ targeting logic
            const { cq_target_token, is_directed_cq_to_me } = enrichWithCqTargeting(
                message,
                isCq,
                this.stationProfile
            );

            // Create internal decode record
            const decode: InternalDecodeRecord = {
                // Internal routing fields
                channel_index: channelIndex,
                slice_id: indexToSliceLetter(channelIndex),

                // Core decode data
                timestamp: new Date().toISOString(),
                band,
                mode,
                dial_hz: dialHz,
                audio_offset_hz: deltaFrequency,
                rf_hz: dialHz + deltaFrequency,
                snr_db: snr,
                dt_sec: deltaTime,
                call,
                grid,
                is_cq: isCq,
                is_my_call: isMyCall,
                raw_text: message,

                // Enriched CQ targeting fields
                is_directed_cq_to_me,
                cq_target_token,

                // Optional WSJT-X flags
                is_new: newDecode,
                low_confidence: lowConfidence,
                off_air: offAir,
            };

            // Log decode for debugging
            console.log(`[Channel ${indexToSliceLetter(channelIndex)}] Decode: ${message} (SNR: ${snr}dB, Call: ${call}, Band: ${band})`);

            // Add to state manager
            this.stateManager.addDecode(decode);

            // Also emit for other listeners
            this.emit('decode', decode);
        } catch (error) {
            console.error(`[ChannelUdpManager] Error parsing decode on channel ${channelIndex}:`, error);
        }
    }

    private handleQsoLogged(channelIndex: number, id: string, buffer: Buffer, offset: number): void {
        try {
            // Time off (QDateTime)
            const { value: timeOff, newOffset: offset1 } = this.readQDateTime(buffer, offset);
            offset = offset1;

            // DX call (QString)
            const { value: dxCall, newOffset: offset2 } = this.readQString(buffer, offset);
            offset = offset2;

            // DX grid (QString)
            const { value: dxGrid, newOffset: offset3 } = this.readQString(buffer, offset);
            offset = offset3;

            // TX frequency (quint64)
            const txFrequency = Number(buffer.readBigUInt64BE(offset));
            offset += 8;

            // Mode (QString)
            const { value: mode, newOffset: offset4 } = this.readQString(buffer, offset);
            offset = offset4;

            // Report sent (QString)
            const { value: reportSent, newOffset: offset5 } = this.readQString(buffer, offset);
            offset = offset5;

            // Report received (QString)
            const { value: reportReceived, newOffset: offset6 } = this.readQString(buffer, offset);
            offset = offset6;

            // TX power (QString)
            const { value: txPower, newOffset: offset7 } = this.readQString(buffer, offset);
            offset = offset7;

            // Comments (QString)
            const { value: comments, newOffset: offset8 } = this.readQString(buffer, offset);
            offset = offset8;

            // Name (QString)
            const { value: name, newOffset: offset9 } = this.readQString(buffer, offset);
            offset = offset9;

            // Time on (QDateTime)
            const { value: timeOn, newOffset: offset10 } = this.readQDateTime(buffer, offset);

            // Get channel info
            const channel = this.stateManager.getChannel(channelIndex);

            // Create QSO record
            const qso: QsoRecord = {
                timestamp_start: timeOn || new Date().toISOString(),
                timestamp_end: timeOff || new Date().toISOString(),
                call: dxCall,
                grid: dxGrid || null,
                band: frequencyToBand(txFrequency),
                freq_hz: txFrequency,
                mode: mode,
                rst_sent: reportSent || null,
                rst_recv: reportReceived || null,
                tx_power_w: txPower ? parseInt(txPower) : null,
                slice_id: indexToSliceLetter(channelIndex),
                channel_index: channelIndex,
                wsjtx_instance: id,
                notes: comments || null,
                exchange_sent: null,
                exchange_recv: null,
            };

            // Add to state manager
            this.stateManager.addQso(qso);

            // Update channel status
            this.stateManager.setChannelStatus(channelIndex, 'decoding');

            // Emit for other listeners
            this.emit('qso-logged', qso);

            console.log(`[ChannelUdpManager] QSO logged on channel ${indexToSliceLetter(channelIndex)}: ${dxCall}`);
        } catch (error) {
            console.error(`[ChannelUdpManager] Error parsing QSO logged on channel ${channelIndex}:`, error);
        }
    }

    private handleClose(channelIndex: number, id: string): void {
        console.log(`[ChannelUdpManager] WSJT-X instance ${id} closed on channel ${channelIndex}`);
        this.stateManager.setChannelStatus(channelIndex, 'offline');
        this.emit('close', { channelIndex, id });
    }

    // === Helper Methods ===

    private readQString(buffer: Buffer, offset: number): { value: string; newOffset: number } {
        const length = buffer.readUInt32BE(offset);
        offset += 4;

        if (length === 0xffffffff || length === 0) {
            return { value: '', newOffset: offset };
        }

        // WSJT-X implementation uses Latin-1/ASCII encoding for QString, not UTF-16BE
        // despite what Qt documentation says about QDataStream
        const value = buffer.toString('latin1', offset, offset + length);
        return { value, newOffset: offset + length };
    }

    private readQDateTime(buffer: Buffer, offset: number): { value: string | null; newOffset: number } {
        try {
            // Julian day number (qint64)
            const julianDay = Number(buffer.readBigInt64BE(offset));
            offset += 8;

            // Milliseconds since midnight (quint32)
            const msOfDay = buffer.readUInt32BE(offset);
            offset += 4;

            // Time spec (quint8)
            const timeSpec = buffer.readUInt8(offset);
            offset += 1;

            if (julianDay === 0) {
                return { value: null, newOffset: offset };
            }

            // Convert Julian day to Date
            // Julian day 0 = November 24, 4714 BC (proleptic Gregorian)
            // JavaScript epoch = January 1, 1970 = Julian day 2440588
            const unixDays = julianDay - 2440588;
            const unixMs = unixDays * 86400000 + msOfDay;
            const date = new Date(unixMs);

            return { value: date.toISOString(), newOffset: offset };
        } catch {
            return { value: null, newOffset: offset };
        }
    }

    private parseDecodeMessage(message: string): { call: string | null; grid: string | null; isCq: boolean } {
        const parts = message.trim().split(/\s+/);
        let call: string | null = null;
        let grid: string | null = null;
        let isCq = false;

        // Check for CQ
        if (parts[0] === 'CQ') {
            isCq = true;
            // CQ [DX/NA/EU/etc] CALLSIGN GRID
            if (parts.length >= 3) {
                const potentialCall = parts[1].length <= 3 ? parts[2] : parts[1];
                if (this.isValidCallsign(potentialCall)) {
                    call = potentialCall;
                }
                // Look for grid
                for (const part of parts.slice(2)) {
                    if (this.isValidGrid(part)) {
                        grid = part.toUpperCase();
                        break;
                    }
                }
            }
        } else {
            // Non-CQ message: first part is usually a callsign
            if (parts.length >= 1 && this.isValidCallsign(parts[0])) {
                call = parts[0];
            } else if (parts.length >= 2 && this.isValidCallsign(parts[1])) {
                call = parts[1];
            }

            // Look for grid
            for (const part of parts) {
                if (this.isValidGrid(part)) {
                    grid = part.toUpperCase();
                    break;
                }
            }
        }

        return { call, grid, isCq };
    }

    private isValidCallsign(str: string): boolean {
        if (!str || str.length < 3 || str.length > 10) return false;
        const callPattern = /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}(\/[A-Z0-9]+)?$/i;
        return callPattern.test(str);
    }

    private isValidGrid(str: string): boolean {
        if (!str || str.length < 4 || str.length > 6) return false;
        const gridPattern = /^[A-R]{2}[0-9]{2}([a-x]{2})?$/i;
        return gridPattern.test(str);
    }

    private isMessageForMe(message: string): boolean {
        if (!this.myCallsign) return false;
        const parts = message.trim().toUpperCase().split(/\s+/);
        // Check if my callsign appears in the message (not as sender)
        // Typical: "MYCALL DX1ABC R-12" means DX1ABC is responding to me
        return parts.length >= 2 && parts[0] === this.myCallsign;
    }
}
