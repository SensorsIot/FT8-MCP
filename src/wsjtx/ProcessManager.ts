import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

export interface WsjtxInstanceConfig {
    name: string;
    band?: string;
    rigName?: string;
    udpPort?: number;
    wsjtxPath?: string;
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
        // Default WSJT-X path (Windows)
        const wsjtxPath = this.config.wsjtxPath || 'C:\\WSJT\\wsjtx\\bin\\wsjtx.exe';

        const args: string[] = [];

        // Use --rig-name to identify this instance
        if (this.config.rigName) {
            args.push('--rig-name', this.config.rigName);
        } else {
            args.push('--rig-name', this.name);
        }

        console.log(`Starting WSJT-X instance: ${this.name}`);
        console.log(`Command: ${wsjtxPath} ${args.join(' ')}`);

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
