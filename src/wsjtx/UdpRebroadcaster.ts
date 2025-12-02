/**
 * UdpRebroadcaster - Consolidates QSO records from multiple WSJT-X instances
 * and rebroadcasts them in ADIF format for external loggers (Log4OM, etc.)
 *
 * Architecture:
 * - Listens to QSO Logged events from LogbookManager
 * - Converts QsoRecord to ADIF text format
 * - Sends to rebroadcast port (default: 2241)
 */

import dgram from 'dgram';
import { EventEmitter } from 'events';
import { QsoRecord } from '../state/types';

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
        console.log(`[UdpRebroadcaster] Started - rebroadcasting ADIF to ${this.config.host}:${this.config.port}`);
    }

    public stop(): void {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            console.log('[UdpRebroadcaster] Stopped');
        }
    }

    /**
     * Rebroadcast a QSO Logged message in ADIF format
     * Called when any channel logs a QSO
     */
    public rebroadcastQsoLogged(qso: QsoRecord): void {
        if (!this.socket || !this.config.enabled) {
            return;
        }

        try {
            const adifMessage = this.encodeAdifMessage(qso);
            const buffer = Buffer.from(adifMessage, 'utf8');

            this.socket.send(buffer, this.config.port, this.config.host, (err) => {
                if (err) {
                    console.error('[UdpRebroadcaster] Error sending ADIF QSO:', err);
                } else {
                    console.log(`[UdpRebroadcaster] Sent ADIF QSO: ${qso.call} on ${qso.band} ${qso.mode}`);
                }
            });
        } catch (error) {
            console.error('[UdpRebroadcaster] Error encoding ADIF message:', error);
        }
    }

    /**
     * Encode a QSO record to ADIF format
     * Format: <FIELDNAME:LENGTH>VALUE ... <EOR>
     *
     * Example:
     * <CALL:6>DL1ABC <GRIDSQUARE:4>JO50 <BAND:3>20m <MODE:3>FT8
     * <QSO_DATE:8>20251202 <TIME_ON:6>152000 <TIME_OFF:6>152130
     * <RST_SENT:3>-08 <RST_RCVD:3>-12 <TX_PWR:2>50 <FREQ:9>14.074000 <EOR>
     */
    private encodeAdifMessage(qso: QsoRecord): string {
        const fields: string[] = [];

        // Required fields
        if (qso.call) {
            fields.push(this.adifField('CALL', qso.call));
        }

        if (qso.mode) {
            fields.push(this.adifField('MODE', qso.mode));
        }

        if (qso.band) {
            fields.push(this.adifField('BAND', qso.band));
        }

        // Frequency in MHz
        if (qso.freq_hz) {
            const freqMhz = (qso.freq_hz / 1000000).toFixed(6);
            fields.push(this.adifField('FREQ', freqMhz));
        }

        // Timestamps
        if (qso.timestamp_start) {
            const startDate = new Date(qso.timestamp_start);
            fields.push(this.adifField('QSO_DATE', this.formatAdifDate(startDate)));
            fields.push(this.adifField('TIME_ON', this.formatAdifTime(startDate)));
        }

        if (qso.timestamp_end) {
            const endDate = new Date(qso.timestamp_end);
            fields.push(this.adifField('TIME_OFF', this.formatAdifTime(endDate)));
        }

        // Optional fields
        if (qso.grid) {
            fields.push(this.adifField('GRIDSQUARE', qso.grid));
        }

        if (qso.rst_sent) {
            fields.push(this.adifField('RST_SENT', qso.rst_sent));
        }

        if (qso.rst_recv) {
            fields.push(this.adifField('RST_RCVD', qso.rst_recv));
        }

        if (qso.tx_power_w) {
            fields.push(this.adifField('TX_PWR', qso.tx_power_w.toString()));
        }

        if (qso.notes) {
            fields.push(this.adifField('COMMENT', qso.notes));
        }

        // End of record
        fields.push('<EOR>');

        return fields.join(' ');
    }

    /**
     * Format an ADIF field: <FIELDNAME:LENGTH>VALUE
     */
    private adifField(fieldName: string, value: string): string {
        const length = Buffer.byteLength(value, 'utf8');
        return `<${fieldName}:${length}>${value}`;
    }

    /**
     * Format date as YYYYMMDD for ADIF
     */
    private formatAdifDate(date: Date): string {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Format time as HHMMSS for ADIF
     */
    private formatAdifTime(date: Date): string {
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${hours}${minutes}${seconds}`;
    }
}
