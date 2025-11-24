import { EventEmitter } from 'events';
import { Config } from '../config';
import { WsjtxUdpListener } from './UdpListener';
import { WsjtxDecode, WsjtxStatus } from './types';
import { ProcessManager, WsjtxInstanceConfig } from './ProcessManager';
import { QsoStateMachine, QsoConfig } from './QsoStateMachine';

export class WsjtxManager extends EventEmitter {
    private config: Config;
    private instances: Map<string, any> = new Map();
    private udpListener: WsjtxUdpListener;
    private processManager: ProcessManager;
    private activeQsos: Map<string, QsoStateMachine> = new Map();

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

            // Forward to active QSO state machines
            const qso = this.activeQsos.get(decode.id);
            if (qso) {
                qso.handleDecode(decode);
            }

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

        throw error;
    }
}

    public stopInstance(name: string): boolean {
    return this.processManager.stopInstance(name);
}

    public executeQso(instanceId: string, targetCallsign: string, myCallsign: string, myGrid: string): void {
    if(this.activeQsos.has(instanceId)) {
    throw new Error(`QSO already in progress for instance ${instanceId}`);
}

const qsoConfig: QsoConfig = {
    instanceId,
    targetCallsign,
    myCallsign,
    myGrid,
};

const qso = new QsoStateMachine(qsoConfig);

qso.on('complete', (result) => {
    console.log(`QSO completed: ${JSON.stringify(result)}`);
    this.activeQsos.delete(instanceId);
    this.emit('qso-complete', { instanceId, ...result });
});

qso.on('failed', (result) => {
    console.log(`QSO failed: ${JSON.stringify(result)}`);
    this.activeQsos.delete(instanceId);
    this.emit('qso-failed', { instanceId, ...result });
});

this.activeQsos.set(instanceId, qso);
qso.start();
    }

    public getInstances(): any[] {
    return this.processManager.getAllInstances().map(instance => ({
        name: instance.name,
        udpPort: instance.udpPort,
        running: instance.isRunning(),
    }));
}

    public async stop(): Promise < void> {
    console.log('Stopping WSJT-X Manager...');

    // Abort all active QSOs
    for(const qso of this.activeQsos.values()) {
    qso.abort();
}
this.activeQsos.clear();

this.processManager.stopAll();
this.udpListener.stop();
    }
}
