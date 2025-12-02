import { EventEmitter } from 'events';
import * as net from 'net';

/**
 * HRD (Ham Radio Deluxe) compatible CAT server for WSJT-X
 *
 * WSJT-X uses the HRD v5/v6 binary protocol:
 * - 16-byte header: size (int32), magic1 (0x1234ABCD), magic2 (0xABCD1234), checksum
 * - UTF-16LE payload with null termination
 *
 * Based on WSJT-X HRDTransceiver.cpp source code
 */

// HRD Protocol constants
const HRD_MAGIC_1 = 0x1234ABCD;
const HRD_MAGIC_2 = 0xABCD1234;
const HRD_HEADER_SIZE = 16;

export interface HrdCatServerConfig {
    port: number;
    sliceIndex: number;
    sliceLetter: string;
}

export class HrdCatServer extends EventEmitter {
    private server: net.Server | null = null;
    private clients: Set<net.Socket> = new Set();
    private config: HrdCatServerConfig;

    // Current state (synced from FlexRadio)
    private frequency: number = 14074000;
    private mode: string = 'USB';
    private pttState: boolean = false;

    constructor(config: HrdCatServerConfig) {
        super();
        this.config = config;
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.handleConnection(socket);
            });

            this.server.on('error', (err) => {
                console.error(`[HRD-CAT ${this.config.sliceLetter}] Server error:`, err);
                reject(err);
            });

            this.server.listen(this.config.port, '127.0.0.1', () => {
                console.log(`[HRD-CAT ${this.config.sliceLetter}] Listening on port ${this.config.port} for Slice ${this.config.sliceLetter}`);
                resolve();
            });
        });
    }

    private handleConnection(socket: net.Socket): void {
        const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[HRD-CAT ${this.config.sliceLetter}] Client connected: ${clientId}`);
        this.clients.add(socket);

        let buffer = Buffer.alloc(0);

        socket.on('data', (data) => {
            console.log(`[HRD-CAT ${this.config.sliceLetter}] Raw data received: ${data.length} bytes`);
            console.log(`[HRD-CAT ${this.config.sliceLetter}] Hex: ${data.toString('hex').substring(0, 100)}...`);

            // Append new data to buffer
            buffer = Buffer.concat([buffer, data]);

            // Process complete messages
            while (buffer.length >= HRD_HEADER_SIZE) {
                // Read message size from header
                const msgSize = buffer.readInt32LE(0);

                // Check if we have complete message
                if (buffer.length < msgSize) {
                    break; // Wait for more data
                }

                // Extract complete message
                const message = buffer.subarray(0, msgSize);
                buffer = buffer.subarray(msgSize);

                // Process the message
                this.processMessage(socket, message);
            }
        });

        socket.on('close', () => {
            console.log(`[HRD-CAT ${this.config.sliceLetter}] Client disconnected: ${clientId}`);
            this.clients.delete(socket);
        });

        socket.on('error', (err) => {
            console.error(`[HRD-CAT ${this.config.sliceLetter}] Socket error:`, err.message);
            this.clients.delete(socket);
        });
    }

    private processMessage(socket: net.Socket, message: Buffer): void {
        // Validate header
        if (message.length < HRD_HEADER_SIZE) {
            console.error(`[HRD-CAT ${this.config.sliceLetter}] Message too short`);
            return;
        }

        const size = message.readInt32LE(0);
        const magic1 = message.readUInt32LE(4);
        const magic2 = message.readUInt32LE(8);
        // const checksum = message.readInt32LE(12); // Unused

        // Validate magic numbers
        if (magic1 !== HRD_MAGIC_1 || magic2 !== HRD_MAGIC_2) {
            console.error(`[HRD-CAT ${this.config.sliceLetter}] Invalid magic: 0x${magic1.toString(16)} 0x${magic2.toString(16)}`);
            return;
        }

        // Extract payload (UTF-16LE, null-terminated)
        const payloadBuffer = message.subarray(HRD_HEADER_SIZE);
        const command = this.decodeUtf16LE(payloadBuffer);

        console.log(`[HRD-CAT ${this.config.sliceLetter}] RX: "${command}"`);

        // Process command and get response
        const response = this.processCommand(command);

        // Send response
        this.sendResponse(socket, response);
    }

    private decodeUtf16LE(buffer: Buffer): string {
        // Find null terminator (2 bytes of 0x00)
        let endIndex = buffer.length;
        for (let i = 0; i < buffer.length - 1; i += 2) {
            if (buffer[i] === 0 && buffer[i + 1] === 0) {
                endIndex = i;
                break;
            }
        }

        // Decode UTF-16LE
        return buffer.subarray(0, endIndex).toString('utf16le');
    }

    private encodeUtf16LE(str: string): Buffer {
        // Add null terminator
        const withNull = str + '\0';
        return Buffer.from(withNull, 'utf16le');
    }

    private sendResponse(socket: net.Socket, response: string): void {
        // Encode payload as UTF-16LE with null terminator
        const payload = this.encodeUtf16LE(response);

        // Calculate total message size
        const totalSize = HRD_HEADER_SIZE + payload.length;

        // Build message
        const message = Buffer.alloc(totalSize);
        message.writeInt32LE(totalSize, 0);        // Size
        message.writeUInt32LE(HRD_MAGIC_1, 4);     // Magic 1
        message.writeUInt32LE(HRD_MAGIC_2, 8);     // Magic 2
        message.writeInt32LE(0, 12);               // Checksum (unused)
        payload.copy(message, HRD_HEADER_SIZE);    // Payload

        console.log(`[HRD-CAT ${this.config.sliceLetter}] TX: "${response}"`);
        socket.write(message);
    }

    private processCommand(command: string): string {
        // Strip radio selector prefix like "[1] " if present
        let cleanedCommand = command.trim();
        const radioSelectorMatch = cleanedCommand.match(/^\[(\d+)\]\s*/);
        if (radioSelectorMatch) {
            cleanedCommand = cleanedCommand.substring(radioSelectorMatch[0].length);
        }

        const lowerCmd = cleanedCommand.toLowerCase();

        // GET commands
        if (lowerCmd === 'get id') {
            return 'FlexRadio';
        }

        if (lowerCmd === 'get version') {
            return '6.0';
        }

        if (lowerCmd === 'get context') {
            return '1';
        }

        if (lowerCmd === 'get contexts') {
            return `1:Slice ${this.config.sliceLetter}`;
        }

        if (lowerCmd === 'get radios') {
            // Format: ID:RadioName,ID:RadioName,...
            return `1:FlexRadio`;
        }

        if (lowerCmd === 'get radio') {
            return `FlexRadio`;
        }

        if (lowerCmd.startsWith('set radio ')) {
            // Parse "set radio ID" command
            return 'OK';
        }

        if (lowerCmd === 'get vfo-count') {
            return '1';
        }

        if (lowerCmd === 'get frequency' || lowerCmd === 'get frequency-hz') {
            return this.frequency.toString();
        }

        if (lowerCmd === 'get frequencies') {
            // Return RX-TX format
            return `${this.frequency}-${this.frequency}`;
        }

        if (lowerCmd === 'get mode') {
            return this.mode;
        }

        if (lowerCmd === 'get buttons') {
            // Return PTT button list
            return 'TX,PTT';
        }

        if (lowerCmd.startsWith('get button-select')) {
            // Return button state
            const buttonName = command.substring(17).trim().replace(/[{}]/g, '');
            if (buttonName.toLowerCase() === 'tx' || buttonName.toLowerCase() === 'ptt') {
                return this.pttState ? '1' : '0';
            }
            return '0';
        }

        if (lowerCmd === 'get dropdowns') {
            // Return mode dropdown
            return 'Mode';
        }

        if (lowerCmd.startsWith('get dropdown-list')) {
            // Return mode list
            return 'USB,LSB,CW,AM,FM,DIGU,DIGL,DATA';
        }

        if (lowerCmd.startsWith('get dropdown-text')) {
            // Return current mode selection
            return `Mode: ${this.mode}`;
        }

        if (lowerCmd === 'get ptt') {
            return this.pttState ? 'ON' : 'OFF';
        }

        // SET commands
        if (lowerCmd.startsWith('set frequency-hz ')) {
            const freqStr = command.split(' ').pop();
            const freq = parseInt(freqStr || '0', 10);
            if (freq > 0) {
                this.frequency = freq;
                console.log(`[HRD-CAT ${this.config.sliceLetter}] Frequency set to ${freq} Hz`);
                this.emit('frequency-change', this.config.sliceIndex, freq);
            }
            return 'OK';
        }

        if (lowerCmd.startsWith('set frequencies-hz ')) {
            // Parse "rx_freq tx_freq" format
            const parts = command.substring(18).trim().split(/\s+/);
            if (parts.length >= 1) {
                const freq = parseInt(parts[0], 10);
                if (freq > 0) {
                    this.frequency = freq;
                    console.log(`[HRD-CAT ${this.config.sliceLetter}] Frequency set to ${freq} Hz`);
                    this.emit('frequency-change', this.config.sliceIndex, freq);
                }
            }
            return 'OK';
        }

        if (lowerCmd.startsWith('set dropdown ')) {
            // Parse "dropdown_name value index" or similar
            const parts = command.substring(12).trim().split(/\s+/);
            if (parts[0]?.toLowerCase() === 'mode' && parts.length >= 2) {
                this.mode = parts[1].toUpperCase();
                console.log(`[HRD-CAT ${this.config.sliceLetter}] Mode set to ${this.mode}`);
                this.emit('mode-change', this.config.sliceIndex, this.mode);
            }
            return 'OK';
        }

        if (lowerCmd.startsWith('set button-select ')) {
            // Parse button command
            const parts = cleanedCommand.substring(18).trim().split(/\s+/);
            const buttonName = parts[0]?.replace(/[{}]/g, '').toLowerCase();
            const state = parts[1] === '1';

            if (buttonName === 'tx' || buttonName === 'ptt') {
                this.pttState = state;
                console.log(`[HRD-CAT ${this.config.sliceLetter}] PTT ${state ? 'ON' : 'OFF'}`);
                this.emit('ptt-change', this.config.sliceIndex, state);
            }
            return 'OK';
        }

        if (lowerCmd.startsWith('set context ')) {
            return 'OK';
        }

        // Unknown command - return OK to avoid errors
        console.log(`[HRD-CAT ${this.config.sliceLetter}] Unknown command: ${command}`);
        return 'OK';
    }

    /**
     * Update the frequency state (called when FlexRadio slice frequency changes)
     */
    public setFrequency(freq: number): void {
        this.frequency = freq;
    }

    /**
     * Update the mode state (called when FlexRadio slice mode changes)
     */
    public setMode(mode: string): void {
        this.mode = mode;
    }

    /**
     * Update PTT state
     */
    public setPtt(state: boolean): void {
        this.pttState = state;
    }

    /**
     * Get current frequency
     */
    public getFrequency(): number {
        return this.frequency;
    }

    public stop(): void {
        // Close all client connections
        for (const client of this.clients) {
            client.destroy();
        }
        this.clients.clear();

        // Close server
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        console.log(`[HRD-CAT ${this.config.sliceLetter}] Server stopped`);
    }
}

/**
 * Manager for multiple HRD CAT servers (one per slice)
 */
export class HrdCatServerManager extends EventEmitter {
    private servers: Map<number, HrdCatServer> = new Map();
    private basePort: number;

    constructor(basePort: number = 7809) {
        super();
        this.basePort = basePort;
    }

    /**
     * Start a CAT server for a specific slice
     */
    public async startServer(sliceIndex: number): Promise<HrdCatServer> {
        if (this.servers.has(sliceIndex)) {
            return this.servers.get(sliceIndex)!;
        }

        const port = this.basePort + sliceIndex;
        const sliceLetter = String.fromCharCode(65 + sliceIndex);

        const server = new HrdCatServer({
            port,
            sliceIndex,
            sliceLetter,
        });

        // Forward events
        server.on('frequency-change', (sliceIdx: number, freq: number) => {
            this.emit('frequency-change', sliceIdx, freq);
        });

        server.on('mode-change', (sliceIdx: number, mode: string) => {
            this.emit('mode-change', sliceIdx, mode);
        });

        server.on('ptt-change', (sliceIdx: number, ptt: boolean) => {
            this.emit('ptt-change', sliceIdx, ptt);
        });

        await server.start();
        this.servers.set(sliceIndex, server);

        return server;
    }

    /**
     * Stop a CAT server for a specific slice
     */
    public stopServer(sliceIndex: number): void {
        const server = this.servers.get(sliceIndex);
        if (server) {
            server.stop();
            this.servers.delete(sliceIndex);
        }
    }

    /**
     * Update frequency for a slice (from FlexRadio)
     */
    public updateFrequency(sliceIndex: number, freq: number): void {
        const server = this.servers.get(sliceIndex);
        if (server) {
            server.setFrequency(freq);
        }
    }

    /**
     * Update mode for a slice (from FlexRadio)
     */
    public updateMode(sliceIndex: number, mode: string): void {
        const server = this.servers.get(sliceIndex);
        if (server) {
            server.setMode(mode);
        }
    }

    /**
     * Get CAT port for a slice
     */
    public getPort(sliceIndex: number): number {
        return this.basePort + sliceIndex;
    }

    /**
     * Stop all servers
     */
    public stopAll(): void {
        for (const server of this.servers.values()) {
            server.stop();
        }
        this.servers.clear();
    }
}
