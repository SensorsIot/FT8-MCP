/**
 * UdpRebroadcaster - Consolidates WSJT-X UDP messages from multiple instances
 * and rebroadcasts them as a single unified instance for external loggers (Log4OM, etc.)
 *
 * Architecture:
 * - Listens to events from ChannelUdpManager (QSO Logged, Status, Decode)
 * - Rewrites messages to use a single instance ID
 * - Sends to rebroadcast port (default: 2241)
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';
import { QsoRecord } from '../state/types';

// WSJT-X UDP Message Types
const WSJT_MAGIC = 0xadbccbda;
const WSJT_SCHEMA = 2;
const WSJT_MSG_QSO_LOGGED = 5;

export interface UdpRebroadcasterConfig {
    enabled: boolean;           // Enable rebroadcasting
    port: number;               // Rebroadcast port (default: 2241)
    instanceId: string;         // Unified instance ID (default: "WSJT-X-MCP")
    host?: string;              // Target host (default: 127.0.0.1)
}

export class UdpRebroadcaster extends EventEmitter {
    private config: UdpRebroadcasterConfig;
    private socket: dgram.Socket | null = null;

    constructor(config: UdpRebroadcasterConfig) {
        super();
        this.config = {
            ...config,
            host: config.host || '127.0.0.1',
        };
    }

    public start(): void {
        if (!this.config.enabled) {
            console.log('[UdpRebroadcaster] Disabled in configuration');
            return;
        }

        this.socket = dgram.createSocket('udp4');
        console.log(`[UdpRebroadcaster] Started - rebroadcasting to ${this.config.host}:${this.config.port} as "${this.config.instanceId}"`);
    }

    public stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            console.log('[UdpRebroadcaster] Stopped');
        }
    }

    /**
     * Rebroadcast a QSO Logged message
     * Called when any channel logs a QSO
     */
    public rebroadcastQsoLogged(qso: QsoRecord): void {
        if (!this.socket || !this.config.enabled) {
            return;
        }

        try {
            const message = this.encodeQsoLoggedMessage(qso);
            this.socket.send(message, this.config.port, this.config.host, (err) => {
                if (err) {
                    console.error('[UdpRebroadcaster] Error sending QSO Logged:', err);
                } else {
                    console.log(`[UdpRebroadcaster] Sent QSO Logged: ${qso.call} on ${qso.band} ${qso.mode}`);
                }
            });
        } catch (error) {
            console.error('[UdpRebroadcaster] Error encoding QSO Logged message:', error);
        }
    }

    /**
     * Encode a QSO Logged message in WSJT-X UDP format
     * Message Type 5 format:
     * [Magic:4][Schema:4][Type:4][ID:QString]
     * [TimeOff:QDateTime][DxCall:QString][DxGrid:QString][TxFreq:quint64]
     * [Mode:QString][ReportSent:QString][ReportRecv:QString][TxPower:QString]
     * [Comments:QString][Name:QString][TimeOn:QDateTime]
     */
    private encodeQsoLoggedMessage(qso: QsoRecord): Buffer {
        const buffers: Buffer[] = [];

        // Header
        const header = Buffer.alloc(12);
        header.writeUInt32BE(WSJT_MAGIC, 0);      // Magic
        header.writeUInt32BE(WSJT_SCHEMA, 4);     // Schema
        header.writeUInt32BE(WSJT_MSG_QSO_LOGGED, 8); // Message Type
        buffers.push(header);

        // Instance ID (QString)
        buffers.push(this.encodeQString(this.config.instanceId));

        // Time Off (QDateTime)
        buffers.push(this.encodeQDateTime(qso.timestamp_end));

        // DX Call (QString)
        buffers.push(this.encodeQString(qso.call));

        // DX Grid (QString)
        buffers.push(this.encodeQString(qso.grid || ''));

        // TX Frequency (quint64)
        const freqBuf = Buffer.alloc(8);
        freqBuf.writeBigUInt64BE(BigInt(qso.freq_hz), 0);
        buffers.push(freqBuf);

        // Mode (QString)
        buffers.push(this.encodeQString(qso.mode));

        // Report Sent (QString)
        buffers.push(this.encodeQString(qso.rst_sent || ''));

        // Report Received (QString)
        buffers.push(this.encodeQString(qso.rst_recv || ''));

        // TX Power (QString)
        buffers.push(this.encodeQString(qso.tx_power_w ? qso.tx_power_w.toString() : ''));

        // Comments (QString)
        buffers.push(this.encodeQString(qso.notes || ''));

        // Name (QString) - rarely used
        buffers.push(this.encodeQString(''));

        // Time On (QDateTime)
        buffers.push(this.encodeQDateTime(qso.timestamp_start));

        return Buffer.concat(buffers);
    }

    /**
     * Encode a QString for WSJT-X UDP
     * Format: length (quint32) + Latin-1 string data
     * 0xFFFFFFFF = null, 0 = empty
     */
    private encodeQString(str: string): Buffer {
        if (!str || str.length === 0) {
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(0xFFFFFFFF, 0);
            return buf;
        }

        // Convert to Latin-1 (single-byte encoding)
        const strBuf = Buffer.from(str, 'latin1');
        const buf = Buffer.alloc(4 + strBuf.length);
        buf.writeUInt32BE(strBuf.length, 0);
        strBuf.copy(buf, 4);
        return buf;
    }

    /**
     * Encode a QDateTime for WSJT-X UDP
     * Format: Julian day (qint64) + milliseconds since midnight (quint32) + time spec (quint8)
     */
    private encodeQDateTime(isoTimestamp: string): Buffer {
        const buf = Buffer.alloc(13);

        if (!isoTimestamp) {
            // Null QDateTime
            buf.writeBigInt64BE(BigInt(0), 0);
            buf.writeUInt32BE(0, 8);
            buf.writeUInt8(0, 12);
            return buf;
        }

        try {
            const date = new Date(isoTimestamp);

            // Calculate Julian day number
            // JavaScript epoch (Jan 1, 1970) = Julian day 2440588
            const unixMs = date.getTime();
            const unixDays = Math.floor(unixMs / 86400000);
            const julianDay = unixDays + 2440588;

            // Calculate milliseconds since midnight UTC
            const utcDate = new Date(date.toISOString());
            const midnightUtc = new Date(utcDate);
            midnightUtc.setUTCHours(0, 0, 0, 0);
            const msOfDay = utcDate.getTime() - midnightUtc.getTime();

            // Write to buffer
            buf.writeBigInt64BE(BigInt(julianDay), 0);  // Julian day
            buf.writeUInt32BE(msOfDay, 8);              // Milliseconds since midnight
            buf.writeUInt8(1, 12);                       // Time spec (1 = UTC)

            return buf;
        } catch (error) {
            console.error('[UdpRebroadcaster] Error encoding QDateTime:', error);
            // Return null QDateTime on error
            buf.writeBigInt64BE(BigInt(0), 0);
            buf.writeUInt32BE(0, 8);
            buf.writeUInt8(0, 12);
            return buf;
        }
    }
}
