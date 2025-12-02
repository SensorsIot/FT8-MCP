import { EventEmitter } from 'events';
import { Config } from '../SettingsManager';
import { Vita49Client, FlexSlice } from './Vita49Client';

export class FlexClient extends EventEmitter {
    private config: Config['flex'];
    private vita49Client: Vita49Client;

    constructor(config: Config['flex']) {
        super();
        this.config = config;
        // VITA 49 API always uses port 4992
        this.vita49Client = new Vita49Client(config.host, 4992);
        this.setupListeners();
    }

    private setupListeners() {
        this.vita49Client.on('connected', () => {
            console.log('FlexRadio connected');
            this.emit('connected');
        });

        this.vita49Client.on('slice-added', (slice: FlexSlice) => {
            console.log(`FlexClient: Slice added - ${slice.id}`);
            this.emit('slice-added', slice);
        });

        this.vita49Client.on('slice-removed', (slice: FlexSlice) => {
            console.log(`FlexClient: Slice removed - ${slice.id}`);
            this.emit('slice-removed', slice);
        });

        this.vita49Client.on('slice-updated', (slice: FlexSlice) => {
            this.emit('slice-updated', slice);
        });

        this.vita49Client.on('error', (error) => {
            console.error('FlexClient error:', error);
            this.emit('error', error);
        });
    }

    public async connect(): Promise<void> {
        console.log(`Connecting to FlexRadio at ${this.config.host}:4992...`);
        await this.vita49Client.connect();
    }

    public async disconnect(): Promise<void> {
        console.log('Disconnecting from FlexRadio...');
        this.vita49Client.disconnect();
    }

    public getSlices(): FlexSlice[] {
        return this.vita49Client.getSlices();
    }

    public isConnected(): boolean {
        return this.vita49Client.isConnected();
    }

    /**
     * Tune a slice to a specific frequency
     */
    public tuneSlice(sliceIndex: number, frequencyHz: number): void {
        this.vita49Client.tuneSlice(sliceIndex, frequencyHz);
    }

    /**
     * Set mode for a slice
     */
    public setSliceMode(sliceIndex: number, mode: string): void {
        this.vita49Client.setSliceMode(sliceIndex, mode);
    }

    /**
     * Set PTT for a slice
     */
    public setSliceTx(sliceIndex: number, tx: boolean): void {
        this.vita49Client.setSliceTx(sliceIndex, tx);
    }

    /**
     * Set DAX channel for a slice
     */
    public setSliceDax(sliceIndex: number, daxChannel: number): void {
        this.vita49Client.setSliceDax(sliceIndex, daxChannel);
    }

    /**
     * Create a DAX RX audio stream for a channel
     * This enables audio streaming from the radio to the DAX virtual audio device
     */
    public createDaxRxAudioStream(daxChannel: number): void {
        this.vita49Client.createDaxRxAudioStream(daxChannel);
    }

    /**
     * Create a DAX TX audio stream
     * This enables audio streaming from the DAX virtual audio device to the radio
     */
    public createDaxTxAudioStream(): void {
        this.vita49Client.createDaxTxAudioStream();
    }

    /**
     * Request DAX stream list for debugging
     */
    public listDaxStreams(): void {
        this.vita49Client.listDaxStreams();
    }
}
