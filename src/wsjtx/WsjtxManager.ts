import { EventEmitter } from 'events';
import { Config } from '../config';
import { WsjtxUdpListener } from './UdpListener';
import { WsjtxDecode, WsjtxStatus } from './types';

export class WsjtxManager extends EventEmitter {
    private config: Config;
    private instances: Map<string, any> = new Map();
    private udpListener: WsjtxUdpListener;

    constructor(config: Config) {
        super();
        this.config = config;
        this.udpListener = new WsjtxUdpListener(2237);
        this.setupListeners();
    }

    private setupListeners() {
        this.udpListener.on('decode', (decode: WsjtxDecode) => {
            console.log(`[${decode.id}] Decode: ${decode.message} (SNR: ${decode.snr})`);
            this.emit('decode', decode);
        });

        this.udpListener.on('status', (status: WsjtxStatus) => {
            console.log(`[${status.id}] Status: ${status.mode} @ ${status.dialFrequency} Hz`);
            this.emit('status', status);
        });

        this.udpListener.on('heartbeat', ({ id }: { id: string }) => {
            console.log(`[${id}] Heartbeat`);
        });
    }

    public async start(): Promise<void> {
        if (this.config.mode === 'STANDARD') {
            console.log('Starting WSJT-X Manager in STANDARD mode.');
            // TODO: Launch single instance or connect to existing
        } else {
            console.log('Starting WSJT-X Manager in FLEX mode.');
            // TODO: Listen for FlexClient events to spawn instances
        }

        this.udpListener.start();
    }

    public async stop(): Promise<void> {
        console.log('Stopping WSJT-X Manager...');
        this.udpListener.stop();
        // TODO: Kill all managed instances
    }
}
