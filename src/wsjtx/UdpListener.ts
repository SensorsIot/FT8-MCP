import dgram from 'dgram';
import { EventEmitter } from 'events';
import { WsjtxMessageType, WsjtxDecode, WsjtxStatus } from './types';

export class WsjtxUdpListener extends EventEmitter {
    private socket: dgram.Socket;
    private port: number;

    constructor(port: number = 2237) {
        super();
        this.port = port;
        this.socket = dgram.createSocket('udp4');
    }

    public start(): void {
        this.socket.on('message', (msg, rinfo) => {
            try {
                this.parseMessage(msg);
            } catch (error) {
                console.error('Error parsing WSJT-X message:', error);
            }
        });

        this.socket.on('error', (err) => {
            console.error('UDP socket error:', err);
            this.emit('error', err);
        });

        this.socket.bind(this.port, () => {
            console.log(`WSJT-X UDP listener started on port ${this.port}`);
        });
    }

    public stop(): void {
        this.socket.close();
    }

    private parseMessage(buffer: Buffer): void {
        // QQT (Qt QDataStream) parsing
        let offset = 0;

        // Magic number (4 bytes)
        const magic = buffer.readUInt32BE(offset);
        offset += 4;
        if (magic !== 0xadbccbda) {
            console.warn('Invalid magic number');
            return;
        }

        // Schema version (4 bytes)
        const schema = buffer.readUInt32BE(offset);
        offset += 4;

        // Message type (4 bytes)
        const messageType = buffer.readUInt32BE(offset);
        offset += 4;

        // ID (QString - length-prefixed UTF-16)
        const { value: id, newOffset } = this.readQString(buffer, offset);
        offset = newOffset;

        switch (messageType) {
            case WsjtxMessageType.HEARTBEAT:
                this.emit('heartbeat', { id });
                break;

            case WsjtxMessageType.STATUS:
                const status = this.parseStatus(buffer, offset, id);
                this.emit('status', status);
                break;

            case WsjtxMessageType.DECODE:
                const decode = this.parseDecode(buffer, offset, id);
                this.emit('decode', decode);
                break;

            case WsjtxMessageType.CLOSE:
                this.emit('close', { id });
                break;

            default:
                // Ignore other message types for now
                break;
        }
    }

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

    private parseStatus(buffer: Buffer, offset: number, id: string): WsjtxStatus {
        // Simplified status parsing - full implementation would parse all fields
        const dialFrequency = Number(buffer.readBigUInt64BE(offset));
        offset += 8;

        const { value: mode, newOffset: offset2 } = this.readQString(buffer, offset);
        const { value: dxCall, newOffset: offset3 } = this.readQString(buffer, offset2);

        return {
            id,
            dialFrequency,
            mode,
            dxCall,
            // Simplified - would parse remaining fields
            report: '',
            txMode: mode,
            txEnabled: false,
            transmitting: false,
            decoding: false,
            rxDF: 0,
            txDF: 0,
            deCall: '',
            deGrid: '',
            dxGrid: '',
            txWatchdog: false,
            subMode: '',
            fastMode: false,
            specialOpMode: 0,
            frequencyTolerance: 0,
            trPeriod: 0,
            configurationName: '',
        };
    }

    private parseDecode(buffer: Buffer, offset: number, id: string): WsjtxDecode {
        // Simplified decode parsing
        const newDecode = buffer.readUInt8(offset) !== 0;
        offset += 1;

        const time = buffer.readUInt32BE(offset);
        offset += 4;

        const snr = buffer.readInt32BE(offset);
        offset += 4;

        const deltaTime = buffer.readDoubleBE(offset);
        offset += 8;

        const deltaFrequency = buffer.readUInt32BE(offset);
        offset += 4;

        const { value: mode, newOffset: offset2 } = this.readQString(buffer, offset);
        const { value: message, newOffset: offset3 } = this.readQString(buffer, offset2);

        return {
            id,
            newDecode,
            time,
            snr,
            deltaTime,
            deltaFrequency,
            mode,
            message,
            lowConfidence: false,
            offAir: false,
        };
    }
}
