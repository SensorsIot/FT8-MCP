import { EventEmitter } from 'events';
import net from 'net';

export interface FlexSlice {
    id: string;
    frequency: number;
    mode: string;
    active: boolean;
    daxChannel?: number;
    rxAnt?: string;
}

export class Vita49Client extends EventEmitter {
    private socket: net.Socket | null = null;
    private host: string;
    private port: number;
    private connected: boolean = false;
    private slices: Map<string, FlexSlice> = new Map();

    constructor(host: string = '255.255.255.255', port: number = 4992) {
        super();
        this.host = host;
        this.port = port;
    }

    public async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket = new net.Socket();

            this.socket.on('connect', () => {
                console.log(`Connected to FlexRadio at ${this.host}:${this.port}`);
                this.connected = true;
                this.sendCommand('sub slice all');
                this.emit('connected');
                resolve();
            });

            this.socket.on('data', (data) => {
                this.handleData(data.toString());
            });

            this.socket.on('error', (err) => {
                console.error('FlexRadio connection error:', err);
                this.emit('error', err);
                reject(err);
            });

            this.socket.on('close', () => {
                console.log('FlexRadio connection closed');
                this.connected = false;
                this.emit('disconnected');
            });

            this.socket.connect(this.port, this.host);
        });
    }

    private handleData(data: string): void {
        const lines = data.split('\n');

        for (const line of lines) {
            if (!line.trim()) continue;

            // Parse FlexRadio responses
            // Format: S<handle>|<message>
            if (line.startsWith('S')) {
                const parts = line.substring(1).split('|');
                if (parts.length >= 2) {
                    this.handleMessage(parts[1].trim());
                }
            }
        }
    }

    private handleMessage(message: string): void {
        const parts = message.split(' ');
        const command = parts[0];

        switch (command) {
            case 'slice':
                this.handleSliceMessage(parts);
                break;
            default:
                // Ignore other messages for now
                break;
        }
    }

    private handleSliceMessage(parts: string[]): void {
        // Format: slice <index> <key>=<value> ...
        if (parts.length < 2) return;

        const sliceIndex = parts[1];
        const sliceId = `slice_${sliceIndex}`;

        let slice = this.slices.get(sliceId);
        if (!slice) {
            slice = {
                id: sliceId,
                frequency: 0,
                mode: '',
                active: false,
            };
            this.slices.set(sliceId, slice);
        }

        // Parse key=value pairs
        for (let i = 2; i < parts.length; i++) {
            const [key, value] = parts[i].split('=');

            switch (key) {
                case 'RF_frequency':
                    slice.frequency = parseFloat(value) * 1e6; // Convert MHz to Hz
                    break;
                case 'mode':
                    slice.mode = value;
                    break;
                case 'active':
                    const wasActive = slice.active;
                    slice.active = value === '1';

                    // Emit events for slice state changes
                    if (!wasActive && slice.active) {
                        console.log(`Slice ${sliceId} activated: ${slice.frequency} Hz, ${slice.mode}`);
                        this.emit('slice-added', slice);
                    } else if (wasActive && !slice.active) {
                        console.log(`Slice ${sliceId} deactivated`);
                        this.emit('slice-removed', slice);
                    }
                    break;
                case 'dax':
                    slice.daxChannel = parseInt(value);
                    break;
                case 'rxant':
                    slice.rxAnt = value;
                    break;
            }
        }

        // Emit update event
        this.emit('slice-updated', slice);
    }

    private sendCommand(command: string): void {
        if (!this.socket || !this.connected) {
            console.warn('Cannot send command: not connected');
            return;
        }

        this.socket.write(`C${command}\n`);
    }

    public getSlices(): FlexSlice[] {
        return Array.from(this.slices.values()).filter(s => s.active);
    }

    public disconnect(): void {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }

    public isConnected(): boolean {
        return this.connected;
    }
}
