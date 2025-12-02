import { EventEmitter } from 'events';
import { FlexSlice } from '../flex/Vita49Client';
import { ProcessManager } from './ProcessManager';
import { positionWsjtxWindows, calculateLayout, detectScreenDimensions, ScreenDimensions } from './WindowManager';
import { configureRigForHrdCat, HRD_CAT_BASE_PORT } from './WsjtxConfig';
import { HrdCatServer } from '../cat/HrdCatServer';
import { StateManager, ChannelUdpManager, frequencyToBand } from '../state';

// WSJT-X uses ~1.46 Hz per bin for FT8 (sample rate 12000 / 8192 FFT bins)
const HZ_PER_BIN = 1.4648;

/**
 * FlexRadioManager - Manages WSJT-X instances for FlexRadio slices
 *
 * Architecture:
 * - Each FlexRadio slice gets its own WSJT-X instance
 * - WSJT-X connects to our HRD CAT server (Ham Radio Deluxe protocol)
 * - We translate HRD commands to FlexRadio API calls
 * - Bidirectional sync: WSJT-X tune -> slice moves, slice tune -> WSJT-X follows
 * - No SmartSDR CAT needed - our HRD TCP shim replaces it
 *
 * Integrated with StateManager and ChannelUdpManager for:
 * - Unified state tracking (McpState)
 * - Dynamic per-channel UDP listeners
 * - Decode aggregation with channel context
 */
export interface StationConfig {
    callsign?: string;
    grid?: string;
}

export class FlexRadioManager extends EventEmitter {
    private processManager: ProcessManager;
    private sliceToInstance: Map<string, string> = new Map();
    private sliceIndexMap: Map<string, number> = new Map();
    private catServers: Map<number, HrdCatServer> = new Map();
    private basePort: number;
    private stationConfig: StationConfig;
    private screenDimensions: ScreenDimensions | null = null;

    // State management (optional - injected from WsjtxManager)
    private stateManager: StateManager | null = null;
    private channelUdpManager: ChannelUdpManager | null = null;

    constructor(processManager: ProcessManager, basePort: number = HRD_CAT_BASE_PORT, stationConfig: StationConfig = {}) {
        super();
        this.processManager = processManager;
        this.basePort = basePort;
        this.stationConfig = stationConfig;
    }

    /**
     * Set the StateManager for unified state tracking
     */
    public setStateManager(stateManager: StateManager): void {
        this.stateManager = stateManager;
    }

    /**
     * Set the ChannelUdpManager for dynamic UDP listeners
     */
    public setChannelUdpManager(channelUdpManager: ChannelUdpManager): void {
        this.channelUdpManager = channelUdpManager;
    }

    /**
     * Update station configuration (callsign, grid)
     * Used when settings are changed from the frontend
     */
    public setStationConfig(config: StationConfig): void {
        this.stationConfig = config;
        console.log(`[FlexRadio] Station config updated: ${config.callsign || '(no callsign)'} / ${config.grid || '(no grid)'}`);
    }

    /**
        * Resolve screen dimensions once for layout calculations
        */
    private async getScreenDimensions(): Promise<ScreenDimensions> {
        if (!this.screenDimensions) {
            this.screenDimensions = await detectScreenDimensions();
            console.log(`[FlexRadio] Detected screen: ${this.screenDimensions.width}x${this.screenDimensions.height}`);
        }
        return this.screenDimensions;
    }

    /**
     * Calculate layout for a slice using detected screen dimensions
     */
    private async getLayoutForSlice(sliceIndex: number) {
        const screen = await this.getScreenDimensions();
        return calculateLayout({
            sliceIndex,
            screenWidth: screen.width,
            screenHeight: screen.height,
        });
    }

    private getCatPort(sliceIndex: number): number {
        return this.basePort + sliceIndex;
    }

    private getSliceIndex(sliceId: string): number {
        const match = sliceId.match(/slice_(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    private getDaxChannel(sliceIndex: number): number {
        return sliceIndex + 1;
    }

    private getSliceLetter(sliceIndex: number): string {
        return String.fromCharCode(65 + sliceIndex);
    }

    /**
     * Start HRD CAT server for a slice
     */
    private async startCatServer(sliceIndex: number, initialFrequency: number): Promise<HrdCatServer> {
        const port = this.getCatPort(sliceIndex);
        const sliceLetter = this.getSliceLetter(sliceIndex);

        const server = new HrdCatServer({
            port,
            sliceIndex,
            sliceLetter,
        });

        // Set initial frequency from FlexRadio slice
        server.setFrequency(initialFrequency);

        // Forward HRD commands to FlexRadio via events
        server.on('frequency-change', (idx: number, freq: number) => {
            console.log(`[FlexRadio] WSJT-X Slice ${this.getSliceLetter(idx)} tuned to ${(freq / 1e6).toFixed(6)} MHz`);
            this.emit('cat-frequency-change', idx, freq);
        });

        server.on('mode-change', (idx: number, mode: string) => {
            console.log(`[FlexRadio] WSJT-X Slice ${this.getSliceLetter(idx)} mode changed to ${mode}`);
            this.emit('cat-mode-change', idx, mode);
        });

        server.on('ptt-change', (idx: number, ptt: boolean) => {
            console.log(`[FlexRadio] WSJT-X Slice ${this.getSliceLetter(idx)} PTT ${ptt ? 'ON' : 'OFF'}`);
            this.emit('cat-ptt-change', idx, ptt);
        });

        await server.start();
        this.catServers.set(sliceIndex, server);

        return server;
    }

    /**
     * Stop HRD CAT server for a slice
     */
    private stopCatServer(sliceIndex: number): void {
        const server = this.catServers.get(sliceIndex);
        if (server) {
            server.stop();
            this.catServers.delete(sliceIndex);
        }
    }

    /**
     * Update HRD CAT server frequency (called when FlexRadio slice changes)
     * This enables bidirectional sync: slice tune in SmartSDR -> WSJT-X follows
     */
    public updateSliceFrequency(sliceIndex: number, frequency: number): void {
        const server = this.catServers.get(sliceIndex);
        if (server) {
            server.setFrequency(frequency);
            console.log(`[FlexRadio] Updated CAT server ${this.getSliceLetter(sliceIndex)} frequency to ${(frequency / 1e6).toFixed(6)} MHz`);
        }
    }

    /**
     * Update HRD CAT server mode (called when FlexRadio slice changes)
     */
    public updateSliceMode(sliceIndex: number, mode: string): void {
        const server = this.catServers.get(sliceIndex);
        if (server) {
            server.setMode(mode);
        }
    }

    public async handleSliceAdded(slice: FlexSlice): Promise<void> {
        if (this.sliceToInstance.has(slice.id)) {
            console.log(`Instance already exists for slice ${slice.id}`);
            return;
        }

        const sliceIndex = this.getSliceIndex(slice.id);
        const sliceLetter = this.getSliceLetter(sliceIndex);
        const daxChannel = slice.daxChannel || this.getDaxChannel(sliceIndex);
        const catPort = this.getCatPort(sliceIndex);
        const udpPort = 2237 + sliceIndex;

        const instanceName = `Slice-${sliceLetter}`;
        const freqMHz = (slice.frequency / 1e6).toFixed(3);

        console.log(`\n=== Auto-launching WSJT-X for slice ${slice.id} ===`);
        console.log(`  Instance Name: ${instanceName}`);
        console.log(`  Frequency: ${freqMHz} MHz`);
        console.log(`  Mode: ${slice.mode}`);
        console.log(`  DAX Channel: ${daxChannel}`);
        console.log(`  HRD CAT Port: ${catPort}`);
        console.log(`  UDP Port: ${udpPort}`);

        // Store slice index mapping
        this.sliceIndexMap.set(slice.id, sliceIndex);

        // Update StateManager with Flex slice data
        if (this.stateManager) {
            this.stateManager.updateFromFlex(sliceIndex, {
                freq_hz: slice.frequency,
                mode: slice.mode,
                is_tx: slice.active,  // First slice or active slice is TX
                dax_rx: daxChannel,
            });
        }

        // Start HRD CAT server FIRST (before WSJT-X tries to connect)
        try {
            await this.startCatServer(sliceIndex, slice.frequency);
            console.log(`  HRD CAT server started on port ${catPort}`);
        } catch (error) {
            console.error(`  Failed to start HRD CAT server:`, error);
            return;
        }

        // Start UDP listener for this channel
        if (this.channelUdpManager) {
            try {
                this.channelUdpManager.startChannel(sliceIndex, instanceName);
                console.log(`  UDP listener started on port ${udpPort}`);
            } catch (error) {
                console.error(`  Failed to start UDP listener:`, error);
                // Continue anyway - CAT still works
            }
        }

        const layout = await this.getLayoutForSlice(sliceIndex);
        const targetFreqHz = 2500;
        const plotWidth = Math.ceil(targetFreqHz / (layout.binsPerPixel * HZ_PER_BIN));

        configureRigForHrdCat(instanceName, {
            sliceIndex: sliceIndex,
            catPort: catPort,
            daxChannel: daxChannel,
            udpPort: udpPort,
            callsign: this.stationConfig.callsign,
            grid: this.stationConfig.grid,
            wideGraph: {
                binsPerPixel: layout.binsPerPixel,
                plotWidth: plotWidth,
                startFreq: 0,
                hideControls: true,
            },
        });

        try {
            this.processManager.startInstance({
                name: instanceName,
                rigName: instanceName,
                sliceIndex: sliceIndex,
                daxChannel: daxChannel,
            });

            this.sliceToInstance.set(slice.id, instanceName);

            // Register instance with StateManager
            if (this.stateManager) {
                this.stateManager.registerInstance(instanceName, sliceIndex);
            }

            this.emit('instance-launched', {
                sliceId: slice.id,
                instanceName,
                sliceLetter,
                daxChannel,
                catPort,
                frequency: slice.frequency,
                udpPort: udpPort,
            });

            positionWsjtxWindows(instanceName, sliceIndex).catch(err => {
                console.error(`Failed to position windows for ${instanceName}:`, err);
            });
        } catch (error) {
            console.error(`Failed to launch instance for slice ${slice.id}:`, error);
            // Stop CAT server and UDP listener if WSJT-X failed to start
            this.stopCatServer(sliceIndex);
            if (this.channelUdpManager) {
                this.channelUdpManager.stopChannel(sliceIndex);
            }
            if (this.stateManager) {
                this.stateManager.setChannelStatus(sliceIndex, 'error');
            }
        }
    }

    public handleSliceRemoved(slice: FlexSlice): void {
        const instanceName = this.sliceToInstance.get(slice.id);
        if (!instanceName) return;

        const sliceIndex = this.sliceIndexMap.get(slice.id);

        console.log(`\n=== Stopping instance ${instanceName} for removed slice ${slice.id} ===`);

        // Stop HRD CAT server
        if (sliceIndex !== undefined) {
            this.stopCatServer(sliceIndex);

            // Stop UDP listener for this channel
            if (this.channelUdpManager) {
                this.channelUdpManager.stopChannel(sliceIndex);
            }

            // Unregister instance from StateManager
            if (this.stateManager) {
                this.stateManager.unregisterInstance(instanceName);
            }
        }

        this.sliceIndexMap.delete(slice.id);
        this.processManager.stopInstance(instanceName);
        this.sliceToInstance.delete(slice.id);
        this.emit('instance-stopped', { sliceId: slice.id, instanceName });
    }

    public handleSliceUpdated(slice: FlexSlice): void {
        const instanceName = this.sliceToInstance.get(slice.id);
        if (instanceName) {
            const sliceIndex = this.sliceIndexMap.get(slice.id);
            if (sliceIndex !== undefined) {
                // Update HRD CAT server state so WSJT-X gets correct frequency when it polls
                this.updateSliceFrequency(sliceIndex, slice.frequency);
                if (slice.mode) {
                    this.updateSliceMode(sliceIndex, slice.mode);
                }

                // Update StateManager with new Flex slice data
                if (this.stateManager) {
                    this.stateManager.updateFromFlex(sliceIndex, {
                        freq_hz: slice.frequency,
                        mode: slice.mode,
                        is_tx: slice.active,
                    });
                }

                this.emit('slice-updated', {
                    sliceId: slice.id,
                    sliceIndex,
                    frequency: slice.frequency,
                    mode: slice.mode
                });
            }
        }
    }

    public getSliceMapping(): Map<string, string> {
        return new Map(this.sliceToInstance);
    }

    /**
     * Stop all CAT servers, UDP listeners, and instances
     */
    public stopAll(): void {
        for (const sliceIndex of this.catServers.keys()) {
            this.stopCatServer(sliceIndex);
        }

        // Stop all UDP listeners
        if (this.channelUdpManager) {
            this.channelUdpManager.stopAll();
        }
    }

    /**
     * Restart all WSJT-X instances (for config changes)
     * Preserves slice mappings and frequencies
     */
    public async restartAllInstances(): Promise<void> {
        console.log('[FlexRadio] Restarting all WSJT-X instances...');

        // Save current slice states before stopping
        const sliceStates: Array<{
            sliceId: string;
            instanceName: string;
            sliceIndex: number;
            frequency: number;
        }> = [];

        for (const [sliceId, instanceName] of this.sliceToInstance.entries()) {
            const sliceIndex = this.sliceIndexMap.get(sliceId);
            if (sliceIndex !== undefined) {
                const catServer = this.catServers.get(sliceIndex);
                const frequency = catServer?.getFrequency() || 14074000;
                sliceStates.push({ sliceId, instanceName, sliceIndex, frequency });
            }
        }

        // Stop all WSJT-X processes (but keep CAT servers running)
        for (const state of sliceStates) {
            this.processManager.stopInstance(state.instanceName);
        }

        // Wait for processes to exit
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Restart each instance
        for (const state of sliceStates) {
            const sliceLetter = this.getSliceLetter(state.sliceIndex);
            const daxChannel = this.getDaxChannel(state.sliceIndex);
            const catPort = this.getCatPort(state.sliceIndex);
            const udpPort = 2237 + state.sliceIndex;

            console.log(`[FlexRadio] Restarting ${state.instanceName}...`);

            const layout = await this.getLayoutForSlice(state.sliceIndex);
            const targetFreqHz = 2500;
            const plotWidth = Math.ceil(targetFreqHz / (layout.binsPerPixel * HZ_PER_BIN));

            configureRigForHrdCat(state.instanceName, {
                sliceIndex: state.sliceIndex,
                catPort: catPort,
                daxChannel: daxChannel,
                udpPort: udpPort,
                callsign: this.stationConfig.callsign,
                grid: this.stationConfig.grid,
                wideGraph: {
                    binsPerPixel: layout.binsPerPixel,
                    plotWidth: plotWidth,
                    startFreq: 0,
                    hideControls: true,
                },
            });

            // Restart the process
            try {
                this.processManager.startInstance({
                    name: state.instanceName,
                    rigName: state.instanceName,
                    sliceIndex: state.sliceIndex,
                    daxChannel: daxChannel,
                });

                // Reposition windows
                positionWsjtxWindows(state.instanceName, state.sliceIndex).catch(err => {
                    console.error(`Failed to position windows for ${state.instanceName}:`, err);
                });
            } catch (error) {
                console.error(`[FlexRadio] Failed to restart ${state.instanceName}:`, error);
            }
        }

        console.log('[FlexRadio] All instances restarted');
    }
}
