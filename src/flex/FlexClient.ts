import { EventEmitter } from 'events';
import { Config } from '../config';

export class FlexClient extends EventEmitter {
    private config: Config['flex'];

    constructor(config: Config['flex']) {
        super();
        this.config = config;
    }

    public async connect(): Promise<void> {
        console.log(`Connecting to FlexRadio at ${this.config.host}:${this.config.port}...`);
        // TODO: Implement Vita49/TCP connection
        // TODO: Discover radio
        // TODO: Subscribe to Slice events
    }

    public async disconnect(): Promise<void> {
        console.log('Disconnecting from FlexRadio...');
        // TODO: Close connection
    }
}
