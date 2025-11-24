import { EventEmitter } from 'events';
import { Config } from '../config';

export class WsjtxManager extends EventEmitter {
    private config: Config;
    private instances: Map<string, any> = new Map(); // Map<friendlyName, Instance>

    constructor(config: Config) {
        super();
        this.config = config;
    }

    public async start(): Promise<void> {
        if (this.config.mode === 'STANDARD') {
            console.log('Starting WSJT-X Manager in STANDARD mode.');
            // TODO: Launch single instance or connect to existing
        } else {
            console.log('Starting WSJT-X Manager in FLEX mode.');
            // TODO: Listen for FlexClient events to spawn instances
        }
    }

    public async stop(): Promise<void> {
        console.log('Stopping WSJT-X Manager...');
        // TODO: Kill all managed instances
    }
}
