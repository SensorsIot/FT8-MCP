import { EventEmitter } from 'events';
import { Config } from '../SettingsManager';
import { WsjtxUdpListener } from './UdpListener';
import { UdpSender } from './UdpSender';
import { WsjtxDecode, WsjtxStatus, SliceState } from './types';
import { ProcessManager, WsjtxInstanceConfig } from './ProcessManager';
import { QsoStateMachine, QsoConfig } from './QsoStateMachine';
import { FlexRadioManager } from './FlexRadioManager';
import {
    StateManager,
    ChannelUdpManager,
    McpState,
    InternalDecodeRecord,
    StationProfile,
} from '../state';
import { LogbookManager, QsoRecord } from '../logbook';
import { DashboardManager } from '../dashboard';

export class WsjtxManager extends EventEmitter {
    private config: Config;
    private instances: Map<string, any> = new Map();
    private udpListener: WsjtxUdpListener;  // Legacy single-port listener (STANDARD mode)
    private udpSender: UdpSender;
    private processManager: ProcessManager;
    private activeQsos: Map<string, QsoStateMachine> = new Map();
    private flexRadioManager?: FlexRadioManager;
    private dashboardManager: DashboardManager;

    // New state management (Phase 1)
    private stateManager: StateManager;
    private channelUdpManager: ChannelUdpManager;
    private logbookManager: LogbookManager;

    constructor(config: Config) {
        super();
        this.config = config;

        // Initialize new state management
        this.stateManager = new StateManager({
            callsign: config.station.callsign,
            grid: config.station.grid,
            decodeHistoryMinutes: 15,
            stationLifetimeSeconds: config.dashboard?.stationLifetimeSeconds ?? 120,
        });

        // Create StationProfile for CQ targeting
        const stationProfile: StationProfile = {
            my_call: config.station.callsign,
            my_continent: config.station.continent || 'NA',
            my_dxcc: config.station.dxcc || '',
            my_prefixes: config.station.prefixes || [],
        };

        this.channelUdpManager = new ChannelUdpManager(
            this.stateManager,
            config.station.callsign,
            stationProfile
        );

        // Initialize LogbookManager for ADIF logging and duplicate detection
        this.logbookManager = new LogbookManager({
            stationCallsign: config.station.callsign,
            stationGrid: config.station.grid,
            enableHrdServer: config.logbook?.enableHrdServer ?? false,
            hrdPort: config.logbook?.hrdPort ?? 7800,
            logbookPath: config.logbook?.path,
        });

        // Legacy components (still used in STANDARD mode and for backward compatibility)
        this.udpListener = new WsjtxUdpListener(2237);
        this.udpSender = new UdpSender(2237);
        this.processManager = new ProcessManager();

        // Dashboard Manager for station tracking
        this.dashboardManager = new DashboardManager({
            stationLifetimeSeconds: config.dashboard?.stationLifetimeSeconds ?? 120,
            snrWeakThreshold: config.dashboard?.snrWeakThreshold ?? -15,
            snrStrongThreshold: config.dashboard?.snrStrongThreshold ?? 0,
            colors: config.dashboard?.colors,
        });
        this.dashboardManager.setLogbookManager(this.logbookManager);

        this.setupListeners();
        this.setupStateListeners();
    }

    /**
     * Setup listeners for the new state management system
     */
    private setupStateListeners(): void {
        // Forward state changes to external listeners
        this.stateManager.on('state-changed', (state: McpState) => {
            this.emit('state-changed', state);
        });

        // Forward decodes from ChannelUdpManager to QSO state machines and external listeners
        this.channelUdpManager.on('decode', (decode: InternalDecodeRecord) => {
            // Convert InternalDecodeRecord to WsjtxDecode for backward compatibility
            const wsjtxDecode: WsjtxDecode = {
                id: decode.slice_id,
                newDecode: decode.is_new ?? false,
                time: 0,  // Not available in DecodeRecord timestamp format
                snr: decode.snr_db,
                deltaTime: decode.dt_sec,
                deltaFrequency: decode.audio_offset_hz,
                mode: decode.mode,
                message: decode.raw_text,
                lowConfidence: decode.low_confidence ?? false,
                offAir: decode.off_air ?? false,
            };

            // Forward to dashboard manager
            this.dashboardManager.handleDecode(wsjtxDecode);

            // Forward to active QSO state machines
            const qso = this.activeQsos.get(decode.slice_id);
            if (qso) {
                qso.handleDecode(wsjtxDecode);
            }

            this.emit('decode', decode);
        });

        // Forward status updates
        this.channelUdpManager.on('status', (status: any) => {
            // Convert to WsjtxStatus for backward compatibility
            // Use same ID format as decodes: "A", "B", "C", "D" (not "Slice-A")
            const wsjtxStatus: WsjtxStatus = {
                id: String.fromCharCode(65 + status.channelIndex),
                dialFrequency: status.dialFrequency,
                mode: status.mode,
                dxCall: status.dxCall || '',
                report: status.report || '',
                txMode: status.txMode || status.mode,
                txEnabled: status.txEnabled,
                transmitting: status.transmitting,
                decoding: status.decoding,
                rxDF: status.rxDF,
                txDF: status.txDF,
                deCall: '',
                deGrid: '',
                dxGrid: '',
                txWatchdog: false,
                subMode: '',
                fastMode: false,
                specialOpMode: 0,
                frequencyTolerance: 0,
                trPeriod: 0,
                configurationName: '',
            };

            this.dashboardManager.handleStatus(wsjtxStatus);
            this.emit('status', status);
        });

        // Forward QSO logged events to LogbookManager for ADIF writing
        this.channelUdpManager.on('qso-logged', (qso: QsoRecord) => {
            // Write to ADIF logbook and update WorkedIndex
            this.logbookManager.logQso(qso);
            this.emit('qso-logged', qso);
        });

        // Forward heartbeats
        this.channelUdpManager.on('heartbeat', (data: { channelIndex: number; id: string }) => {
            console.log(`[Channel ${data.channelIndex}] Heartbeat from ${data.id}`);
        });
    }

    /**
     * Legacy listener setup (for STANDARD mode and backward compatibility)
     */
    private setupListeners() {
        this.udpListener.on('decode', (decode: WsjtxDecode) => {
            console.log(`[${decode.id}] Decode: ${decode.message} (SNR: ${decode.snr})`);

            // Forward to dashboard manager
            this.dashboardManager.handleDecode(decode);

            // Forward to active QSO state machines
            const qso = this.activeQsos.get(decode.id);
            if (qso) {
                qso.handleDecode(decode);
            }

            this.emit('decode', decode);
        });

        this.udpListener.on('status', (status: WsjtxStatus) => {
            console.log(`[${status.id}] Status: ${status.mode} @ ${status.dialFrequency} Hz`);

            // Forward to dashboard manager
            this.dashboardManager.handleStatus(status);

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

        // Forward dashboard updates
        this.dashboardManager.on('update', (slices: SliceState[]) => {
            this.emit('stations-update', slices);
        });
    }

    public async start(): Promise<void> {
        // Initialize LogbookManager (loads existing ADIF logbook -> populates WorkedIndex)
        try {
            await this.logbookManager.initialize();
            console.log(`[Logbook] Initialized with ${this.logbookManager.getQsoCount()} existing QSOs`);
            console.log(`[Logbook] Path: ${this.logbookManager.getLogbookPath()}`);
        } catch (error) {
            console.error('[Logbook] Failed to initialize:', error);
            // Continue anyway - QSOs won't be logged to file but everything else works
        }

        if (this.config.mode === 'STANDARD') {
            console.log('Starting WSJT-X Manager in STANDARD mode.');
            // Auto-start a default instance for Standard mode
            this.startInstance({
                name: this.config.standard.rigName || 'IC-7300',
                rigName: this.config.standard.rigName,
            });
        } else {
            console.log('Starting WSJT-X Manager in FLEX mode.');
            // Slice Master will be initialized when FlexClient is connected
            // In FLEX mode, ChannelUdpManager handles per-channel UDP - don't start legacy listener
        }

        // Only start legacy UDP listener in STANDARD mode
        // In FLEX mode, ChannelUdpManager handles per-channel UDP communication
        if (this.config.mode === 'STANDARD') {
            this.udpListener.start();
        }
    }

    public setFlexClient(flexClient: any): void {
        // Update StateManager with Flex connection status
        this.stateManager.setFlexConnected(true);

        // Initialize FlexRadio manager for multi-slice operation
        // Pass station config (callsign, grid) for WSJT-X INI configuration
        this.flexRadioManager = new FlexRadioManager(
            this.processManager,
            undefined, // use default HRD CAT base port
            {
                callsign: this.config.station.callsign,
                grid: this.config.station.grid,
            }
        );

        // Wire up StateManager and ChannelUdpManager to FlexRadioManager
        this.flexRadioManager.setStateManager(this.stateManager);
        this.flexRadioManager.setChannelUdpManager(this.channelUdpManager);

        // Handle slice events from FlexRadio
        flexClient.on('slice-added', (slice: any) => {
            // Extract slice index from ID (e.g., "slice_0" -> 0)
            const match = slice.id?.match(/slice_(\d+)/);
            const sliceIndex = match ? parseInt(match[1]) : 0;

            // Set DAX channel for this slice (1-indexed: slice 0 -> DAX 1, slice 1 -> DAX 2, etc.)
            const daxChannel = sliceIndex + 1;
            console.log(`Setting DAX channel ${daxChannel} for slice ${sliceIndex}`);
            flexClient.setSliceDax(sliceIndex, daxChannel);

            // Create DAX RX audio stream for this channel to enable audio routing
            console.log(`Creating DAX RX audio stream for channel ${daxChannel}`);
            flexClient.createDaxRxAudioStream(daxChannel);

            // Auto-tune slice to configured default band frequency
            const defaultBands = this.config.flex.defaultBands;
            if (defaultBands && sliceIndex < defaultBands.length) {
                const targetFreq = defaultBands[sliceIndex];
                const freqMHz = (targetFreq / 1e6).toFixed(3);
                console.log(`Auto-tuning slice ${sliceIndex} to ${freqMHz} MHz (configured default)`);

                // Tune to FT8 frequency and set DIGU mode
                flexClient.tuneSlice(sliceIndex, targetFreq);
                flexClient.setSliceMode(sliceIndex, 'DIGU');

                // Update the slice object with the target frequency so HRD CAT server uses correct freq
                slice.frequency = targetFreq;
            }

            if (this.flexRadioManager) {
                this.flexRadioManager.handleSliceAdded(slice);
            }
        });

        flexClient.on('slice-removed', (slice: any) => {
            if (this.flexRadioManager) {
                this.flexRadioManager.handleSliceRemoved(slice);
            }
        });

        flexClient.on('slice-updated', (slice: any) => {
            if (this.flexRadioManager) {
                this.flexRadioManager.handleSliceUpdated(slice);
            }
        });

        // Handle CAT events from WSJT-X (via CatServer) -> send to FlexRadio
        this.flexRadioManager.on('cat-frequency-change', (sliceIndex: number, freq: number) => {
            console.log(`Forwarding frequency change to FlexRadio: slice ${sliceIndex} -> ${freq} Hz`);
            flexClient.tuneSlice(sliceIndex, freq);
        });

        this.flexRadioManager.on('cat-mode-change', (sliceIndex: number, mode: string) => {
            console.log(`Forwarding mode change to FlexRadio: slice ${sliceIndex} -> ${mode}`);
            flexClient.setSliceMode(sliceIndex, mode);
        });

        this.flexRadioManager.on('cat-ptt-change', (sliceIndex: number, tx: boolean) => {
            console.log(`Forwarding PTT to FlexRadio: slice ${sliceIndex} -> ${tx ? 'TX' : 'RX'}`);
            flexClient.setSliceTx(sliceIndex, tx);
        });

        // Handle instance launch - HRD CAT server provides initial frequency
        // No need to send UDP frequency command since WSJT-X gets it from HRD CAT
        this.flexRadioManager.on('instance-launched', (data: {
            sliceId: string;
            instanceName: string;
            sliceLetter: string;
            daxChannel: number;
            catPort: number;
            frequency: number;
            udpPort: number;
        }) => {
            console.log(`Instance ${data.instanceName} launched for slice ${data.sliceId}`);
            console.log(`  HRD CAT server on port ${data.catPort} will provide frequency ${(data.frequency / 1e6).toFixed(3)} MHz`);
        });
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

    public executeQso(instanceId: string, targetCallsign: string, myCallsign: string, myGrid: string): void {
        if (this.activeQsos.has(instanceId)) {
            throw new Error(`QSO already in progress for instance ${instanceId}`);
        }

        // Find the most recent decode for the target callsign
        // We search all channels in the last 60 seconds
        const allDecodes = this.getAllDecodes(60000);
        const targetDecode = allDecodes
            .filter(d => d.call === targetCallsign)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        if (!targetDecode) {
            throw new Error(`No recent decode found for ${targetCallsign}. Cannot initiate QSO.`);
        }

        // Convert DecodeRecord to WsjtxDecode format for the QSO state machine
        const timestampMs = new Date(targetDecode.timestamp).getTime();
        const wsjtxDecode = {
            id: instanceId,
            time: Math.floor((timestampMs % 86400000) / 1000), // ms since midnight UTC
            snr: targetDecode.snr_db,
            deltaTime: targetDecode.dt_sec,
            deltaFrequency: targetDecode.audio_offset_hz,
            mode: targetDecode.mode,
            message: targetDecode.raw_text,
            newDecode: targetDecode.is_new ?? false,
            lowConfidence: targetDecode.low_confidence ?? false,
            offAir: targetDecode.off_air ?? false,
        };

        console.log(`Found decode for ${targetCallsign}: SNR ${targetDecode.snr_db}dB @ ${targetDecode.audio_offset_hz}Hz`);

        const qsoConfig: QsoConfig = {
            instanceId,
            targetCallsign,
            myCallsign,
            myGrid,
            initialDecode: wsjtxDecode,
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

    public getSliceStates(): SliceState[] {
        return this.dashboardManager.getSliceStates();
    }

    public getDashboardManager(): DashboardManager {
        return this.dashboardManager;
    }

    // === New State Management API (Phase 1) ===

    /**
     * Get full MCP state (FSD §11.1)
     */
    public getMcpState(): McpState {
        return this.stateManager.getState();
    }

    /**
     * Get the StateManager instance for direct access
     */
    public getStateManager(): StateManager {
        return this.stateManager;
    }

    /**
     * Get recent decodes for a channel (FSD §11.5)
     * Returns internal decode records with routing info
     */
    public getDecodes(channelIndex: number, sinceMs?: number): InternalDecodeRecord[] {
        return this.stateManager.getDecodes(channelIndex, sinceMs);
    }

    /**
     * Get all recent decodes across all channels
     * Returns internal decode records with routing info
     */
    public getAllDecodes(sinceMs?: number): InternalDecodeRecord[] {
        return this.stateManager.getAllDecodes(sinceMs);
    }

    /**
     * Get decodes snapshot for MCP exposure (v7 FSD §3)
     * Returns DecodesSnapshot with MCP-facing DecodeRecord[] (no routing fields)
     */
    public getDecodesSnapshot(sinceMs?: number) {
        return this.stateManager.getDecodesSnapshot(sinceMs);
    }

    /**
     * Check if a station is worked on band/mode (FSD §11.6)
     */
    public isWorked(call: string, band: string, mode: string): boolean {
        return this.logbookManager.isWorked(call, band, mode);
    }

    /**
     * Set TX channel (FSD §11.3)
     */
    public setTxChannel(channelIndex: number): void {
        this.stateManager.setTxChannel(channelIndex);
    }

    /**
     * Get LogbookManager for logbook access
     */
    public getLogbookManager(): LogbookManager {
        return this.logbookManager;
    }

    /**
     * Get logbook path
     */
    public getLogbookPath(): string {
        return this.logbookManager.getLogbookPath();
    }

    /**
     * Get total QSO count from logbook
     */
    public getQsoCount(): number {
        return this.logbookManager.getQsoCount();
    }

    /**
     * Export logbook to a new ADIF file
     */
    public exportLogbook(outputPath: string): void {
        this.logbookManager.exportToFile(outputPath);
    }

    /**
     * Clear logbook (creates backup first)
     */
    public clearLogbook(): void {
        this.logbookManager.clearLogbook();
    }

    // === WSJT-X UDP Control Methods ===

    /**
     * Configure WSJT-X instance mode and settings
     * Note: This cannot change dial frequency - only CAT/SmartSDR can do that
     */
    public configureInstance(
        instanceId: string,
        options: {
            mode?: string;           // e.g., "FT8", "FT4"
            frequencyTolerance?: number;
            submode?: string;
            fastMode?: boolean;
            trPeriod?: number;       // T/R period in seconds
            rxDF?: number;           // RX audio frequency offset
            dxCall?: string;
            dxGrid?: string;
            generateMessages?: boolean;
        }
    ): void {
        this.udpSender.sendConfigure(instanceId, options);
    }

    /**
     * Switch WSJT-X to a named configuration profile
     * This can effectively change bands if the profile has different frequency settings
     */
    public switchConfiguration(instanceId: string, configurationName: string): void {
        this.udpSender.sendSwitchConfiguration(instanceId, configurationName);
    }

    /**
     * Clear decode windows in WSJT-X
     * window: 0 = Band Activity, 1 = Rx Frequency, 2 = Both
     */
    public clearDecodes(instanceId: string, window: 0 | 1 | 2 = 2): void {
        this.udpSender.sendClear(instanceId, window);
    }

    /**
     * Set the station's Maidenhead grid location
     */
    public setLocation(instanceId: string, grid: string): void {
        this.udpSender.sendLocation(instanceId, grid);
    }

    /**
     * Highlight a callsign in the WSJT-X band activity window
     */
    public highlightCallsign(
        instanceId: string,
        callsign: string,
        backgroundColor: { r: number; g: number; b: number; a?: number },
        foregroundColor: { r: number; g: number; b: number; a?: number },
        highlightLast: boolean = true
    ): void {
        this.udpSender.sendHighlightCallsign(instanceId, callsign, backgroundColor, foregroundColor, highlightLast);
    }

    /**
     * Halt TX in WSJT-X
     */
    public haltTx(instanceId: string, autoTxOnly: boolean = true): void {
        this.udpSender.sendHaltTx(instanceId, autoTxOnly);
    }

    /**
     * Set free text message in WSJT-X
     */
    public setFreeText(instanceId: string, text: string, send: boolean = false): void {
        this.udpSender.sendFreeText(instanceId, text, send);
    }

    /**
     * Reply to a station (simulate double-click on decode)
     */
    public replyToStation(
        instanceId: string,
        time: number,
        snr: number,
        deltaTime: number,
        deltaFrequency: number,
        mode: string,
        message: string
    ): void {
        this.udpSender.sendReply(instanceId, time, snr, deltaTime, deltaFrequency, mode, message);
    }

    /**
     * Set dial frequency in WSJT-X (Rig Control Command)
     * This will tune WSJT-X to the specified frequency, which will then
     * command the radio via CAT. Band changes automatically if frequency
     * is on a different band.
     *
     * @param instanceId - Instance ID (rig name)
     * @param frequencyHz - Dial frequency in Hz (e.g., 14074000 for 20m FT8)
     * @param mode - Optional mode to set (e.g., "USB", "DIGU")
     */
    public setFrequency(instanceId: string, frequencyHz: number, mode?: string): void {
        this.udpSender.sendSetFrequency(instanceId, frequencyHz, mode);
    }

    /**
     * Restart all WSJT-X instances (for config changes that require INI reload)
     * Waits for graceful shutdown before restarting
     */
    public async restartAllInstances(): Promise<void> {
        console.log('Restarting all WSJT-X instances for config change...');

        if (this.flexRadioManager) {
            // In FLEX mode, use FlexRadioManager to restart instances
            await this.flexRadioManager.restartAllInstances();
        } else {
            // In STANDARD mode, restart via ProcessManager
            const instances = this.processManager.getAllInstances();
            const configs: WsjtxInstanceConfig[] = instances.map(inst => ({
                name: inst.name,
                udpPort: inst.udpPort,
                rigName: inst.name,
            }));

            // Stop all instances
            this.processManager.stopAll();

            // Wait for processes to exit
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Restart all instances
            for (const config of configs) {
                this.processManager.startInstance(config);
            }
        }

        console.log('WSJT-X instances restarted');
    }

    public async stop(): Promise<void> {
        console.log('Stopping WSJT-X Manager...');

        // Abort all active QSOs
        for (const qso of this.activeQsos.values()) {
            qso.abort();
        }
        this.activeQsos.clear();

        // Send graceful Close messages to all WSJT-X instances before killing them
        console.log('Sending Close messages to WSJT-X instances...');
        const channels = this.stateManager.getChannels();
        for (let i = 0; i < 4; i++) {
            const channel = channels[i];
            if (channel && channel.connected) {
                const instanceId = `WSJT-X - Slice-${channel.id}`;  // e.g., "WSJT-X - Slice-A"
                const udpPort = 2237 + i;

                // Create a temporary UDP sender for this instance
                const sender = new UdpSender(udpPort);
                sender.sendClose(instanceId);
                sender.close();

                console.log(`  Sent Close to ${instanceId} on UDP port ${udpPort}`);
            }
        }

        // Wait 2 seconds for WSJT-X instances to gracefully close
        console.log('Waiting for graceful shutdown...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Stop HRD CAT servers and UDP listeners (via FlexRadioManager)
        if (this.flexRadioManager) {
            this.flexRadioManager.stopAll();
        }

        // Stop new state management components
        this.channelUdpManager.stopAll();
        this.stateManager.stop();
        this.logbookManager.stop();

        // Stop legacy components
        this.dashboardManager.stop();
        this.processManager.stopAll();
        this.udpListener.stop();

        // Mark Flex as disconnected
        this.stateManager.setFlexConnected(false);
    }
}
