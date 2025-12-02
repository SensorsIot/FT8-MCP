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
    private commandSeq: number = 1;

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
                // Subscribe to slice status updates
                this.sendCommand('sub slice all');
                // Subscribe to DAX audio updates
                this.sendCommand('sub dax all');
                // Request current slice list
                this.sendCommand('slice list');
                // Request DAX audio client list
                this.sendCommand('dax audio list');
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

            // Log all FlexRadio responses for debugging DAX issues
            if (line.includes('dax') || line.includes('audio') || line.includes('stream')) {
                console.log(`[FlexRadio DAX] ${line}`);
            }

            // Parse FlexRadio responses
            // Format: S<handle>|<message> or status messages
            // Also handle R (response) messages
            if (line.startsWith('S')) {
                const parts = line.substring(1).split('|');
                if (parts.length >= 2) {
                    this.handleMessage(parts[1].trim());
                }
            } else if (line.startsWith('R')) {
                // Response to a command - log for debugging
                console.log(`[FlexRadio Response] ${line}`);
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
        const isNew = !slice;
        if (!slice) {
            slice = {
                id: sliceId,
                frequency: 0,
                mode: '',
                active: false,
            };
            this.slices.set(sliceId, slice);
        }

        const wasActive = slice.active;
        let inUseChanged = false;

        // First pass: parse ALL key=value pairs to get complete slice state
        for (let i = 2; i < parts.length; i++) {
            const [key, value] = parts[i].split('=');

            switch (key) {
                case 'RF_frequency':
                    slice.frequency = parseFloat(value) * 1e6; // Convert MHz to Hz
                    break;
                case 'mode':
                    slice.mode = value;
                    break;
                case 'in_use':
                    // in_use indicates slice exists/allocated - this is what we care about
                    // Note: 'active' field means currently selected/focused slice, which we ignore
                    slice.active = value === '1';
                    if (slice.active !== wasActive) {
                        inUseChanged = true;
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

        // Second pass: emit events AFTER all fields are parsed
        if (inUseChanged) {
            if (!wasActive && slice.active) {
                console.log(`Slice ${sliceId} activated: ${slice.frequency} Hz, ${slice.mode}`);
                this.emit('slice-added', slice);
            } else if (wasActive && !slice.active) {
                console.log(`Slice ${sliceId} deactivated`);
                this.emit('slice-removed', slice);
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

        // FlexRadio API format: C<seq_num>|<command>
        const seq = this.commandSeq++;
        const fullCommand = `C${seq}|${command}\n`;
        console.log(`Sending command: ${fullCommand.trim()}`);
        this.socket.write(fullCommand);
    }

    public getSlices(): FlexSlice[] {
        return Array.from(this.slices.values()).filter(s => s.active);
    }

    /**
     * Tune a slice to a specific frequency
     * @param sliceIndex Slice index (0, 1, 2, ...)
     * @param frequencyHz Frequency in Hz
     */
    public tuneSlice(sliceIndex: number, frequencyHz: number): void {
        // FlexRadio API: slice tune <index> <freq_in_mhz>
        const freqMhz = (frequencyHz / 1e6).toFixed(6);
        this.sendCommand(`slice tune ${sliceIndex} ${freqMhz}`);
    }

    /**
     * Set the mode for a slice
     * @param sliceIndex Slice index (0, 1, 2, ...)
     * @param mode Mode string (USB, LSB, DIGU, DIGL, CW, AM, FM, etc.)
     */
    public setSliceMode(sliceIndex: number, mode: string): void {
        // FlexRadio API: slice set <index> mode=<mode>
        this.sendCommand(`slice set ${sliceIndex} mode=${mode}`);
    }

    /**
     * Set PTT (transmit) state for a slice
     * @param sliceIndex Slice index (0, 1, 2, ...)
     * @param tx True for transmit, false for receive
     */
    public setSliceTx(sliceIndex: number, tx: boolean): void {
        // FlexRadio API: xmit <0|1>
        // Note: FlexRadio has a single transmitter, so this affects the active TX slice
        this.sendCommand(`xmit ${tx ? '1' : '0'}`);
    }

    /**
     * Set the DAX channel for a slice
     * @param sliceIndex Slice index (0, 1, 2, ...)
     * @param daxChannel DAX channel (1-8), 0 to disable
     */
    public setSliceDax(sliceIndex: number, daxChannel: number): void {
        // FlexRadio API: slice set <index> dax=<channel>
        console.log(`Setting DAX channel ${daxChannel} for slice ${sliceIndex}`);
        this.sendCommand(`slice set ${sliceIndex} dax=${daxChannel}`);
    }

    /**
     * Create a DAX RX audio stream for a channel
     * This creates the audio stream that will be sent to the DAX audio device
     * @param daxChannel DAX channel (1-8)
     */
    public createDaxRxAudioStream(daxChannel: number): void {
        // FlexRadio API: stream create type=dax_rx dax_channel=<channel>
        console.log(`Creating DAX RX audio stream for channel ${daxChannel}`);
        this.sendCommand(`stream create type=dax_rx dax_channel=${daxChannel}`);
    }

    /**
     * Create a DAX TX audio stream for transmitting
     * @param daxChannel DAX channel (typically 1 for TX)
     */
    public createDaxTxAudioStream(daxChannel: number = 1): void {
        // FlexRadio API: stream create type=dax_tx
        console.log(`Creating DAX TX audio stream`);
        this.sendCommand(`stream create type=dax_tx`);
    }

    /**
     * Request the current DAX audio stream list
     */
    public listDaxStreams(): void {
        this.sendCommand('stream list');
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
