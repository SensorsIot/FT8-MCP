import dgram from 'dgram';
import { WsjtxMessageType } from './types';

// Maximum quint32 value - signals "no change" for numeric fields in Configure message
const NO_CHANGE = 0xFFFFFFFF;

export class UdpSender {
    private socket: dgram.Socket;
    private targetPort: number;
    private targetHost: string;

    constructor(port: number = 2237, host: string = 'localhost') {
        this.targetPort = port;
        this.targetHost = host;
        this.socket = dgram.createSocket('udp4');
    }

    /**
     * Write a QString (Qt UTF-16BE string) to a buffer
     * Empty string = 0xFFFFFFFF length (null QString)
     */
    private writeQString(buffer: Buffer, offset: number, value: string): number {
        if (!value || value.length === 0) {
            buffer.writeUInt32BE(0xffffffff, offset);
            return offset + 4;
        }

        // Qt QString uses UTF-16BE, Node uses UTF-16LE, so we need to swap
        const utf16Buffer = Buffer.from(value, 'utf16le');
        // Swap bytes to convert to UTF-16BE
        for (let i = 0; i < utf16Buffer.length; i += 2) {
            const temp = utf16Buffer[i];
            utf16Buffer[i] = utf16Buffer[i + 1];
            utf16Buffer[i + 1] = temp;
        }
        buffer.writeUInt32BE(utf16Buffer.length, offset);
        offset += 4;
        utf16Buffer.copy(buffer, offset);
        return offset + utf16Buffer.length;
    }

    private createHeader(messageType: number, id: string): Buffer {
        const buffers: Buffer[] = [];

        // Magic number
        const magic = Buffer.alloc(4);
        magic.writeUInt32BE(0xadbccbda, 0);
        buffers.push(magic);

        // Schema version
        const schema = Buffer.alloc(4);
        schema.writeUInt32BE(2, 0);
        buffers.push(schema);

        // Message type
        const type = Buffer.alloc(4);
        type.writeUInt32BE(messageType, 0);
        buffers.push(type);

        // ID (QString)
        const idBuffer = Buffer.alloc(4 + Buffer.from(id, 'utf16le').length);
        this.writeQString(idBuffer, 0, id);
        buffers.push(idBuffer);

        return Buffer.concat(buffers);
    }

    public sendReply(id: string, time: number, snr: number, deltaTime: number, deltaFrequency: number, mode: string, message: string): void {
        const header = this.createHeader(4, id); // Reply = 4

        const body = Buffer.alloc(1000); // Allocate enough space
        let offset = 0;

        // Time (quint32)
        body.writeUInt32BE(time, offset);
        offset += 4;

        // SNR (qint32)
        body.writeInt32BE(snr, offset);
        offset += 4;

        // Delta time (double)
        body.writeDoubleBE(deltaTime, offset);
        offset += 8;

        // Delta frequency (quint32)
        body.writeUInt32BE(deltaFrequency, offset);
        offset += 4;

        // Mode (QString)
        offset = this.writeQString(body, offset, mode);

        // Message (QString)
        offset = this.writeQString(body, offset, message);

        // Low confidence (bool)
        body.writeUInt8(0, offset);
        offset += 1;

        // Modifiers (quint8) - 0x02 = Shift modifier (enables TX)
        body.writeUInt8(0x02, offset);
        offset += 1;

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);
    }

    public sendHaltTx(id: string, autoTxOnly: boolean = true): void {
        const header = this.createHeader(8, id); // HaltTx = 8

        const body = Buffer.alloc(1);
        body.writeUInt8(autoTxOnly ? 1 : 0, 0);

        const packet = Buffer.concat([header, body]);
        this.send(packet);
    }

    public sendFreeText(id: string, text: string, send: boolean = false): void {
        const header = this.createHeader(WsjtxMessageType.FREE_TEXT, id);

        const body = Buffer.alloc(1000);
        let offset = 0;

        offset = this.writeQString(body, offset, text);
        body.writeUInt8(send ? 1 : 0, offset);
        offset += 1;

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);
        console.log(`[UDP] Sent FreeText to ${id}: "${text}" (send=${send}) on port ${this.targetPort}`);
    }

    /**
     * Configure WSJT-X mode and settings
     * Empty strings or NO_CHANGE values mean "don't change"
     */
    public sendConfigure(
        id: string,
        options: {
            mode?: string;           // e.g., "FT8", "FT4"
            frequencyTolerance?: number;
            submode?: string;
            fastMode?: boolean;
            trPeriod?: number;       // T/R period in seconds
            rxDF?: number;           // RX audio frequency offset
            dxCall?: string;
            dxGrid?: string;
            generateMessages?: boolean;
        }
    ): void {
        const header = this.createHeader(WsjtxMessageType.CONFIGURE, id);

        const body = Buffer.alloc(2000);
        let offset = 0;

        // Mode (QString) - empty = no change
        offset = this.writeQString(body, offset, options.mode || '');

        // Frequency Tolerance (quint32) - max = no change
        body.writeUInt32BE(options.frequencyTolerance ?? NO_CHANGE, offset);
        offset += 4;

        // Submode (QString)
        offset = this.writeQString(body, offset, options.submode || '');

        // Fast Mode (bool)
        body.writeUInt8(options.fastMode ? 1 : 0, offset);
        offset += 1;

        // T/R Period (quint32)
        body.writeUInt32BE(options.trPeriod ?? NO_CHANGE, offset);
        offset += 4;

        // Rx DF (quint32) - max = no change
        body.writeUInt32BE(options.rxDF ?? NO_CHANGE, offset);
        offset += 4;

        // DX Call (QString)
        offset = this.writeQString(body, offset, options.dxCall || '');

        // DX Grid (QString)
        offset = this.writeQString(body, offset, options.dxGrid || '');

        // Generate Messages (bool)
        body.writeUInt8(options.generateMessages ? 1 : 0, offset);
        offset += 1;

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);

        const optionsSummary = Object.entries(options)
            .filter(([_, v]) => v !== undefined && v !== '')
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        console.log(`[UDP] Sent Configure to ${id}: ${optionsSummary} on port ${this.targetPort}`);
    }

    /**
     * Switch to a named configuration profile in WSJT-X
     */
    public sendSwitchConfiguration(id: string, configurationName: string): void {
        const header = this.createHeader(WsjtxMessageType.SWITCH_CONFIGURATION, id);

        const body = Buffer.alloc(500);
        const offset = this.writeQString(body, 0, configurationName);

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);
    }

    /**
     * Clear decode windows
     * window: 0 = Band Activity, 1 = Rx Frequency, 2 = Both
     */
    public sendClear(id: string, window: 0 | 1 | 2 = 2): void {
        const header = this.createHeader(WsjtxMessageType.CLEAR, id);

        const body = Buffer.alloc(1);
        body.writeUInt8(window, 0);

        const packet = Buffer.concat([header, body]);
        this.send(packet);
    }

    /**
     * Set the station's Maidenhead grid location
     */
    public sendLocation(id: string, grid: string): void {
        const header = this.createHeader(WsjtxMessageType.LOCATION, id);

        const body = Buffer.alloc(100);
        const offset = this.writeQString(body, 0, grid);

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);
    }

    /**
     * Set dial frequency in WSJT-X (Rig Control Command)
     * This will tune WSJT-X to the specified frequency, which will then
     * command the radio via CAT. Band changes automatically if frequency
     * is on a different band.
     *
     * Note: The Rig Control message format is simpler than other messages -
     * it does NOT include the instance ID in the header.
     *
     * Format: magic(4) + schema(4) + type(4) + frequency(8) + mode(QString)
     *
     * @param id - Instance ID (rig name) - used only for logging, not sent
     * @param frequencyHz - Dial frequency in Hz (e.g., 14074000 for 20m FT8)
     * @param mode - Optional mode to set (e.g., "USB", "DIGU")
     */
    public sendSetFrequency(id: string, frequencyHz: number, mode?: string): void {
        // Rig Control message does NOT include instance ID - simpler format
        const buffers: Buffer[] = [];

        // Magic number
        const magic = Buffer.alloc(4);
        magic.writeUInt32BE(0xadbccbda, 0);
        buffers.push(magic);

        // Schema version
        const schema = Buffer.alloc(4);
        schema.writeUInt32BE(2, 0);
        buffers.push(schema);

        // Message type (12 = Rig Control)
        const type = Buffer.alloc(4);
        type.writeUInt32BE(WsjtxMessageType.RIG_CONTROL, 0);
        buffers.push(type);

        // Frequency (qint64 - 8 bytes, signed 64-bit integer)
        const freq = Buffer.alloc(8);
        freq.writeBigInt64BE(BigInt(frequencyHz), 0);
        buffers.push(freq);

        // Mode (QString) - empty = don't change mode
        const modeStr = mode || '';
        const modeBuffer = Buffer.alloc(500);
        const modeLen = this.writeQString(modeBuffer, 0, modeStr);
        buffers.push(modeBuffer.slice(0, modeLen));

        const packet = Buffer.concat(buffers);
        this.send(packet);

        console.log(`[UDP] Sent SetFrequency: ${frequencyHz} Hz${mode ? `, mode=${mode}` : ''} to port ${this.targetPort}`);
    }

    /**
     * Send Close message to gracefully shut down WSJT-X instance
     * Message Type 6 - requests WSJT-X to close gracefully
     */
    public sendClose(id: string): void {
        const header = this.createHeader(WsjtxMessageType.CLOSE, id);
        this.send(header);
        console.log(`[UDP] Sent Close message to ${id} on port ${this.targetPort}`);
    }

    /**
     * Highlight a callsign in the WSJT-X band activity window
     */
    public sendHighlightCallsign(
        id: string,
        callsign: string,
        backgroundColor: { r: number; g: number; b: number; a?: number },
        foregroundColor: { r: number; g: number; b: number; a?: number },
        highlightLast: boolean = true
    ): void {
        const header = this.createHeader(WsjtxMessageType.HIGHLIGHT_CALLSIGN, id);

        const body = Buffer.alloc(500);
        let offset = 0;

        // Callsign
        offset = this.writeQString(body, offset, callsign);

        // Background color (QColor - ARGB format)
        // Qt QColor in QDataStream: 1 byte spec (1=RGB), then 4 x quint16 for RGBA
        body.writeUInt8(1, offset); // color spec = RGB
        offset += 1;
        body.writeUInt16BE(backgroundColor.a ?? 255, offset);
        offset += 2;
        body.writeUInt16BE(backgroundColor.r, offset);
        offset += 2;
        body.writeUInt16BE(backgroundColor.g, offset);
        offset += 2;
        body.writeUInt16BE(backgroundColor.b, offset);
        offset += 2;
        body.writeUInt16BE(0, offset); // padding
        offset += 2;

        // Foreground color
        body.writeUInt8(1, offset);
        offset += 1;
        body.writeUInt16BE(foregroundColor.a ?? 255, offset);
        offset += 2;
        body.writeUInt16BE(foregroundColor.r, offset);
        offset += 2;
        body.writeUInt16BE(foregroundColor.g, offset);
        offset += 2;
        body.writeUInt16BE(foregroundColor.b, offset);
        offset += 2;
        body.writeUInt16BE(0, offset);
        offset += 2;

        // Highlight last (bool)
        body.writeUInt8(highlightLast ? 1 : 0, offset);
        offset += 1;

        const packet = Buffer.concat([header, body.slice(0, offset)]);
        this.send(packet);
    }

    private send(packet: Buffer): void {
        this.socket.send(packet, this.targetPort, this.targetHost, (err) => {
            if (err) {
                console.error('UDP send error:', err);
            }
        });
    }

    public setTarget(port: number, host: string = 'localhost'): void {
        this.targetPort = port;
        this.targetHost = host;
    }

    public close(): void {
        this.socket.close();
    }
}
