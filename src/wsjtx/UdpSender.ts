import dgram from 'dgram';

export class UdpSender {
    private socket: dgram.Socket;
    private targetPort: number;
    private targetHost: string;

    constructor(port: number = 2237, host: string = 'localhost') {
        this.targetPort = port;
        this.targetHost = host;
        this.socket = dgram.createSocket('udp4');
    }

    private writeQString(buffer: Buffer, offset: number, value: string): number {
        if (!value || value.length === 0) {
            buffer.writeUInt32BE(0xffffffff, offset);
            return offset + 4;
        }

        const utf16Buffer = Buffer.from(value, 'utf16le');
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

        // Modifiers (quint8)
        body.writeUInt8(0, offset);
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
        const header = this.createHeader(9, id); // FreeText = 9

        const body = Buffer.alloc(1000);
        let offset = 0;

        offset = this.writeQString(body, offset, text);
        body.writeUInt8(send ? 1 : 0, offset);
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

    public close(): void {
        this.socket.close();
    }
}
