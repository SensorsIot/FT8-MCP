import { EventEmitter } from 'events';
import { Config } from '../config';
import { WsjtxUdpListener } from './UdpListener';
import { WsjtxDecode, WsjtxStatus } from './types';
import { ProcessManager, WsjtxInstanceConfig } from './ProcessManager';

export class WsjtxManager extends EventEmitter {
    private config: Config;
    private instances: Map<string, any> = new Map();
    private udpListener: WsjtxUdpListener;
    private processManager: ProcessManager;

    constructor(config: Config) {
        super();
        this.config = config;
        this.udpListener = new WsjtxUdpListener(2237);
        this.processManager = new ProcessManager();
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

        this.processManager.on('instance-started', (instance) => {
            console.log(`Process manager: Instance ${instance.name} started`);
        });

        this.processManager.on('instance-stopped', (instance) => {
            console.log(`Process manager: Instance ${instance.name} stopped`);
        });
    }

    public async start(): Promise<void> {
        if (this.config.mode === 'STANDARD') {
            console.log('Starting WSJT-X Manager in STANDARD mode.');
            // Auto-start a default instance for Standard mode
            this.startInstance({
                name: this.config.standard.rigName || 'IC-7300',
                rigName: this.config.standard.rigName,
            });
        } else {
            console.log('Starting WSJT-X Manager in FLEX mode.');
            // TODO: Listen for FlexClient events to spawn instances
        }

        this.udpListener.start();
    }

    public startInstance(config: WsjtxInstanceConfig): void {
        try {
            this.processManager.startInstance(config);
        } catch (error) {
            console.error('Failed to start instance:', error);
            throw error;
        }
    }

    public stopInstance(name: string): boolean {
        return this.processManager.stopInstance(name);
    }

    public getInstances(): any[] {
        return this.processManager.getAllInstances().map(instance => ({
            name: instance.name,
            udpPort: instance.udpPort,
            running: instance.isRunning(),
        }));
    }

    public async stop(): Promise<void> {
        console.log('Stopping WSJT-X Manager...');
        this.processManager.stopAll();
        this.udpListener.stop();
    }
}
