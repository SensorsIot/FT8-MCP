import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

export interface WsjtxInstanceConfig {
    name: string;
    band?: string;
    rigName?: string;
    udpPort?: number;
    wsjtxPath?: string;
    // FlexRadio-specific settings
    sliceIndex?: number;        // Slice index (A=0, B=1, etc.)
    daxChannel?: number;        // DAX audio channel (1-8)
    smartCatPort?: number;      // SmartCAT TCP port for CAT control
    smartCatHost?: string;      // SmartCAT host (usually localhost)
}

// Default path - can be overridden via config
let defaultWsjtxPath = 'C:\\WSJT\\wsjtx\\bin\\wsjtx.exe';

export function setDefaultWsjtxPath(path: string) {
    defaultWsjtxPath = path;
}

export function getDefaultWsjtxPath(): string {
    return defaultWsjtxPath;
}

export class WsjtxProcess extends EventEmitter {
    private process: ChildProcess | null = null;
    private config: WsjtxInstanceConfig;
    public readonly name: string;
    public readonly udpPort: number;

    constructor(config: WsjtxInstanceConfig) {
        super();
        this.config = config;
        this.name = config.name;
        this.udpPort = config.udpPort || 2237;
    }

    public start(): void {
        // Use configured path or default
        const wsjtxPath = this.config.wsjtxPath || defaultWsjtxPath;

        const args: string[] = [];

        // Use --rig-name to identify this instance and load its saved configuration
        if (this.config.rigName) {
            args.push('--rig-name', this.config.rigName);
        } else {
            args.push('--rig-name', this.name);
        }

        console.log(`\nStarting WSJT-X instance: ${this.name}`);
        console.log(`  Command: ${wsjtxPath} ${args.join(' ')}`);

        // Log FlexRadio-specific configuration (auto-configured via INI)
        if (this.config.smartCatPort !== undefined) {
            console.log(`  === FlexRadio Configuration ===`);
            console.log(`  DAX Channel: ${this.config.daxChannel || 'Not specified'}`);
            console.log(`  SmartCAT: ${this.config.smartCatHost || '127.0.0.1'}:${this.config.smartCatPort}`);
            console.log(`  Rig Type: Ham Radio Deluxe`);
            console.log(`  Audio In: DAX Audio RX ${this.config.daxChannel || 1} (FlexRadio Systems DAX Audio)`);
            console.log(`  Audio Out: DAX Audio TX (FlexRadio Systems DAX TX)`);
            console.log(`  =====================================================`);
        }

        this.process = spawn(wsjtxPath, args, {
            detached: false,
            stdio: 'ignore',
        });

        this.process.on('error', (error) => {
            console.error(`WSJT-X process error (${this.name}):`, error);
            this.emit('error', error);
        });

        this.process.on('exit', (code, signal) => {
            console.log(`WSJT-X instance ${this.name} exited with code ${code}, signal ${signal}`);
            this.emit('exit', { code, signal });
            this.process = null;
        });

        this.emit('started');
    }

    public stop(): void {
        if (this.process) {
            console.log(`Stopping WSJT-X instance: ${this.name}`);
            this.process.kill('SIGTERM');

            // Force kill after 5 seconds if still running
            setTimeout(() => {
                if (this.process && !this.process.killed) {
                    console.log(`Force killing WSJT-X instance: ${this.name}`);
                    this.process.kill('SIGKILL');
                }
            }, 5000);
        }
    }

    public isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }
}

export class ProcessManager extends EventEmitter {
    private instances: Map<string, WsjtxProcess> = new Map();
    private nextPort: number = 2237;

    public startInstance(config: WsjtxInstanceConfig): WsjtxProcess {
        if (this.instances.has(config.name)) {
            throw new Error(`Instance ${config.name} already exists`);
        }

        // Assign UDP port if not specified
        if (!config.udpPort) {
            config.udpPort = this.nextPort++;
        }

        const instance = new WsjtxProcess(config);

        instance.on('started', () => {
            console.log(`Instance ${config.name} started successfully`);
            this.emit('instance-started', instance);
        });

        instance.on('exit', () => {
            console.log(`Instance ${config.name} has exited`);
            this.instances.delete(config.name);
            this.emit('instance-stopped', instance);
        });

        instance.on('error', (error) => {
            console.error(`Instance ${config.name} error:`, error);
            this.emit('instance-error', { instance, error });
        });

        this.instances.set(config.name, instance);
        instance.start();

        return instance;
    }

    public stopInstance(name: string): boolean {
        const instance = this.instances.get(name);
        if (!instance) {
            return false;
        }

        instance.stop();
        return true;
    }

    public getInstance(name: string): WsjtxProcess | undefined {
        return this.instances.get(name);
    }

    public getAllInstances(): WsjtxProcess[] {
        return Array.from(this.instances.values());
    }

    public stopAll(): void {
        console.log('Stopping all WSJT-X instances...');
        for (const instance of this.instances.values()) {
            instance.stop();
        }
    }
}
