import { EventEmitter } from 'events';
import { FlexSlice } from '../flex/Vita49Client';
import { ProcessManager } from './ProcessManager';

export class SliceMasterLogic extends EventEmitter {
    private processManager: ProcessManager;
    private sliceToInstance: Map<string, string> = new Map();

    constructor(processManager: ProcessManager) {
        super();
        this.processManager = processManager;
    }

    public handleSliceAdded(slice: FlexSlice): void {
        // Only auto-launch for digital modes
        const digitalModes = ['DIGU', 'DIGL', 'FT8', 'FT4', 'JT65', 'JT9'];
        if (!digitalModes.includes(slice.mode.toUpperCase())) {
            console.log(`Slice ${slice.id} is not a digital mode (${slice.mode}), skipping auto-launch`);
            return;
        }

        if (this.sliceToInstance.has(slice.id)) {
            console.log(`Instance already exists for slice ${slice.id}`);
            return;
        }

        // Generate instance name from frequency
        const freqMHz = (slice.frequency / 1e6).toFixed(3);
        const instanceName = `Slice_${freqMHz}MHz`;

        console.log(`Auto-launching WSJT-X for slice ${slice.id}: ${instanceName}`);

        try {
            this.processManager.startInstance({
                name: instanceName,
                rigName: instanceName,
                // TODO: Configure DAX audio channel
                // TODO: Configure CAT control
            });

            this.sliceToInstance.set(slice.id, instanceName);
            this.emit('instance-launched', { sliceId: slice.id, instanceName });
        } catch (error) {
            console.error(`Failed to launch instance for slice ${slice.id}:`, error);
        }
    }

    public handleSliceRemoved(slice: FlexSlice): void {
        const instanceName = this.sliceToInstance.get(slice.id);
        if (!instanceName) {
            return;
        }

        console.log(`Stopping instance ${instanceName} for removed slice ${slice.id}`);

        this.processManager.stopInstance(instanceName);
        this.sliceToInstance.delete(slice.id);
        this.emit('instance-stopped', { sliceId: slice.id, instanceName });
    }

    public handleSliceUpdated(slice: FlexSlice): void {
        // TODO: Update instance configuration if frequency/mode changes
        // For now, we'll just log
        const instanceName = this.sliceToInstance.get(slice.id);
        if (instanceName) {
            console.log(`Slice ${slice.id} updated: ${slice.frequency} Hz, ${slice.mode}`);
        }
    }

    public getSliceMapping(): Map<string, string> {
        return new Map(this.sliceToInstance);
    }
}
