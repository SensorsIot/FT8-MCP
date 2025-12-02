import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * WSJT-X Configuration Manager
 * Handles pre-configuration of WSJT-X INI files before launch
 */

// WSJT-X uses ~1.46 Hz per bin for FT8 (sample rate 12000 / 8192 FFT bins)
const HZ_PER_BIN = 1.4648;

export interface WideGraphConfig {
    binsPerPixel?: number;      // 1-10, controls zoom level
    startFreq?: number;         // Start frequency offset in Hz
    plotZero?: number;          // Brightness offset
    plotGain?: number;          // Brightness gain
    hideControls?: boolean;     // Hide control panel on Wide Graph window
    plotWidth?: number;         // Width of waterfall plot in pixels (determines Hz range)
}

export interface RigConfig {
    smartCatHost?: string;      // SmartCAT host (usually 127.0.0.1)
    smartCatPort?: number;      // SmartCAT TCP port (7831 + sliceIndex, matching SliceMaster)
    daxChannel?: number;        // DAX audio channel (1-8)
}

export interface Ts2000RigConfig {
    comPort: string;            // Virtual COM port (e.g., COM31)
    daxChannel?: number;        // DAX audio channel (1-8)
    baudRate?: number;          // Baud rate (default 38400)
}

export interface NetworkCatConfig {
    host: string;               // TCP host (usually 127.0.0.1)
    port: number;               // TCP port (60001-60004)
    daxChannel?: number;        // DAX audio channel (1-8)
}

export interface FlexSliceConfig {
    sliceIndex: number;         // 0-3 for Slice A-D
    catPort: number;            // CAT TCP port (60001-60004)
    daxChannel?: number;        // DAX audio channel (1-8)
    udpPort?: number;           // UDP server port (2237-2240)
}

export interface HrdCatConfig {
    sliceIndex: number;         // 0-3 for Slice A-D
    catPort: number;            // HRD CAT TCP port (7800-7803)
    daxChannel?: number;        // DAX audio channel (1-8)
    udpPort?: number;           // UDP server port (2237-2240)
    callsign?: string;          // Station callsign (e.g., HB9BLA)
    grid?: string;              // Station grid locator (e.g., JN37VL)
    wideGraph?: WideGraphConfig; // Optional Wide Graph overrides
}

// HamlibRig IDs for FlexRadio SmartSDR Slices
// These are the rig IDs WSJT-X uses for native Flex slice support
export const FLEX_SLICE_HAMLIB_IDS: Record<number, number> = {
    0: 1035,  // Slice A
    1: 1036,  // Slice B
    2: 1037,  // Slice C
    3: 1038,  // Slice D
};

// SmartCAT base port used by SliceMaster (7831 for slice A, 7832 for B, etc.)
export const SMARTCAT_BASE_PORT = 7831;

// HRD CAT server base port (our implementation: 7809 for slice A, 7810 for B, etc.)
// The default HRD port is 7809 according to WSJT-X HRDTransceiver.cpp
export const HRD_CAT_BASE_PORT = 7809;

export interface WsjtxInstanceSettings {
    rigName: string;
    wideGraph?: WideGraphConfig;
    rig?: RigConfig;
}

/**
 * Get the base WSJT-X config directory path (for default instance)
 */
export function getWsjtxConfigDir(): string {
    // Windows: %LOCALAPPDATA%\WSJT-X
    // Linux: ~/.config/WSJT-X
    // macOS: ~/Library/Preferences/WSJT-X
    if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Local', 'WSJT-X');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Preferences', 'WSJT-X');
    } else {
        return path.join(os.homedir(), '.config', 'WSJT-X');
    }
}

/**
 * Get the instance-specific settings folder path
 *
 * IMPORTANT: WSJT-X --rig-name creates/uses a SEPARATE FOLDER per instance:
 *   - Windows: %LOCALAPPDATA%\WSJT-X - <rigName>\
 *   - The folder contains: WSJT-X - <rigName>.ini
 *
 * This matches SliceMaster's working configuration pattern.
 */
export function getInstanceConfigDir(rigName: string): string {
    if (process.platform === 'win32') {
        return path.join(os.homedir(), 'AppData', 'Local', `WSJT-X - ${rigName}`);
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Preferences', `WSJT-X - ${rigName}`);
    } else {
        return path.join(os.homedir(), '.config', `WSJT-X - ${rigName}`);
    }
}

/**
 * Get the INI file path for a specific WSJT-X instance
 *
 * Pattern: %LOCALAPPDATA%\WSJT-X - <rigName>\WSJT-X - <rigName>.ini
 *
 * This is the SliceMaster-compatible folder structure:
 *   - Folder: "WSJT-X - Slice-A"
 *   - INI file: "WSJT-X - Slice-A.ini" (inside that folder)
 */
export function getInstanceIniPath(rigName: string): string {
    const configDir = getInstanceConfigDir(rigName);
    // INI file is inside the instance-specific folder with matching name
    return path.join(configDir, `WSJT-X - ${rigName}.ini`);
}

/**
 * Calculate BinsPerPixel to show a target frequency range in a given window width
 * @param targetFreqHz Target frequency span in Hz
 * @param windowWidth Window width in pixels
 * @returns BinsPerPixel value (clamped to 1-10)
 */
export function calculateBinsPerPixel(targetFreqHz: number, windowWidth: number): number {
    // Hz per pixel needed
    const hzPerPixel = targetFreqHz / windowWidth;
    // Convert to bins per pixel
    const binsPerPixel = hzPerPixel / HZ_PER_BIN;
    // Clamp to valid range (1-10) and round to nearest integer
    return Math.max(1, Math.min(10, Math.round(binsPerPixel)));
}

/**
 * Calculate the window width needed to show a target frequency range with given BinsPerPixel
 * @param targetFreqHz Target frequency span in Hz
 * @param binsPerPixel BinsPerPixel setting
 * @returns Required window width in pixels
 */
export function calculateWindowWidth(targetFreqHz: number, binsPerPixel: number): number {
    const hzPerPixel = binsPerPixel * HZ_PER_BIN;
    return Math.ceil(targetFreqHz / hzPerPixel);
}

/**
 * Parse a simple INI file into sections
 */
function parseIni(content: string): Map<string, Map<string, string>> {
    const sections = new Map<string, Map<string, string>>();
    let currentSection = '';

    for (const line of content.split('\n')) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
            continue;
        }

        // Section header
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            if (!sections.has(currentSection)) {
                sections.set(currentSection, new Map());
            }
            continue;
        }

        // Key=value pair
        const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
        if (kvMatch && currentSection) {
            const key = kvMatch[1].trim();
            const value = kvMatch[2];
            sections.get(currentSection)!.set(key, value);
        }
    }

    return sections;
}

/**
 * Load the WSJT-X template INI file
 * This template MUST exist as part of the project
 * @throws Error if template file is not found
 */
function loadTemplateIni(): Map<string, Map<string, string>> {
    const templateDir = path.join(__dirname, '..', '..', 'templates');
    const templatePath = path.join(templateDir, 'wsjtx-template.ini');

    if (!fs.existsSync(templatePath)) {
        throw new Error(
            `WSJT-X template file not found: ${templatePath}\n` +
            `The template file is required for proper WSJT-X configuration.`
        );
    }

    console.log(`  Loading template from ${templatePath}`);
    const content = fs.readFileSync(templatePath, 'utf-8');
    return parseIni(content);
}

/**
 * Serialize sections back to INI format
 */
function serializeIni(sections: Map<string, Map<string, string>>): string {
    const lines: string[] = [];

    for (const [sectionName, sectionData] of sections) {
        lines.push(`[${sectionName}]`);
        for (const [key, value] of sectionData) {
            lines.push(`${key}=${value}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Configure Wide Graph settings in the INI file
 * This should be called BEFORE launching WSJT-X
 */
export function configureWideGraph(
    rigName: string,
    config: WideGraphConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    console.log(`Configuring Wide Graph for ${rigName}:`);
    console.log(`  INI path: ${iniPath}`);

    // Ensure instance-specific config directory exists
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    // Ensure WideGraph section exists
    if (!sections.has('WideGraph')) {
        sections.set('WideGraph', new Map());
    }

    const wideGraph = sections.get('WideGraph')!;

    // Apply settings
    if (config.binsPerPixel !== undefined) {
        wideGraph.set('BinsPerPixel', config.binsPerPixel.toString());
        console.log(`  BinsPerPixel: ${config.binsPerPixel}`);
    }

    if (config.startFreq !== undefined) {
        wideGraph.set('StartFreq', config.startFreq.toString());
        console.log(`  StartFreq: ${config.startFreq}`);
    }

    if (config.plotZero !== undefined) {
        wideGraph.set('PlotZero', config.plotZero.toString());
    }

    if (config.plotGain !== undefined) {
        wideGraph.set('PlotGain', config.plotGain.toString());
    }

    if (config.plotWidth !== undefined) {
        wideGraph.set('PlotWidth', config.plotWidth.toString());
        console.log(`  PlotWidth: ${config.plotWidth}`);
    }

    // HideControls must be in [Configuration] section, NOT [WideGraph]
    if (config.hideControls !== undefined) {
        // Ensure Configuration section exists
        if (!sections.has('Configuration')) {
            sections.set('Configuration', new Map());
        }
        const configSection = sections.get('Configuration')!;
        configSection.set('HideControls', config.hideControls ? 'true' : 'false');
        console.log(`  HideControls: ${config.hideControls} (in [Configuration] section)`);

        // Remove HideControls from WideGraph section if it exists (wrong location)
        if (wideGraph.has('HideControls')) {
            wideGraph.delete('HideControls');
            console.log(`  Removed HideControls from [WideGraph] section (incorrect location)`);
        }
    }

    // Always remove cached geometry from WideGraph to force WSJT-X to respect settings
    if (wideGraph.has('geometry')) {
        wideGraph.delete('geometry');
        console.log(`  Removed WideGraph geometry cache`);
    }

    // Remove MainWindow geometry caches that can affect Wide Graph
    if (sections.has('MainWindow')) {
        const mainWindow = sections.get('MainWindow')!;
        if (mainWindow.has('geometry')) {
            mainWindow.delete('geometry');
            console.log(`  Removed MainWindow geometry cache`);
        }
        if (mainWindow.has('geometryNoControls')) {
            mainWindow.delete('geometryNoControls');
            console.log(`  Removed MainWindow geometryNoControls cache`);
        }
    }

    // Write back
    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  Configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write config:`, error);
        return false;
    }
}

/**
 * Configure WSJT-X instance for optimal 2500 Hz waterfall display
 * @param rigName The rig name for the instance
 * @param windowWidth The Wide Graph window width in pixels
 */
export function configureFor2500Hz(rigName: string, windowWidth: number): void {
    // Calculate BinsPerPixel for 2500 Hz in the given window width
    const binsPerPixel = calculateBinsPerPixel(2500, windowWidth);

    // Calculate actual frequency range that will be displayed
    const actualFreqRange = windowWidth * binsPerPixel * HZ_PER_BIN;

    console.log(`  Target: 2500 Hz in ${windowWidth}px window`);
    console.log(`  Calculated BinsPerPixel: ${binsPerPixel}`);
    console.log(`  Actual frequency range: ~${Math.round(actualFreqRange)} Hz`);

    configureWideGraph(rigName, {
        binsPerPixel: binsPerPixel,
        startFreq: 0,
    });
}

/**
 * Configure Rig/Radio settings for SmartCAT (FlexRadio)
 * This configures WSJT-X to use "Ham Radio Deluxe" rig type to connect to SmartCAT
 * Configuration matches SliceMaster's proven working settings
 */
export function configureRigForSmartCat(
    rigName: string,
    config: RigConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    const smartCatHost = config.smartCatHost || '127.0.0.1';
    const smartCatPort = config.smartCatPort || SMARTCAT_BASE_PORT;
    const daxChannel = config.daxChannel || 1;

    console.log(`Configuring Rig for SmartCAT (${rigName}):`);
    console.log(`  INI path: ${iniPath}`);
    console.log(`  SmartCAT: ${smartCatHost}:${smartCatPort}`);
    console.log(`  DAX Channel: ${daxChannel}`);

    // Ensure instance-specific config directory exists
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    // Ensure Configuration section exists
    if (!sections.has('Configuration')) {
        sections.set('Configuration', new Map());
    }

    const configSection = sections.get('Configuration')!;

    // Use "Ham Radio Deluxe" rig type (matches SliceMaster's working config)
    configSection.set('Rig', 'Ham Radio Deluxe');

    // CATNetworkPort uses combined "host:port" format (SliceMaster convention)
    configSection.set('CATNetworkPort', `${smartCatHost}:${smartCatPort}`);

    // PTT method - CAT (matches SliceMaster)
    configSection.set('PTTMethod', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::PTTMethod\\0\\0\\0\\0\\xfPTT_method_CAT\\0)');

    // Split operation mode - None
    configSection.set('SplitMode', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::SplitMode\\0\\0\\0\\0\\x10split_mode_none\\0)');

    // Audio settings - DAX channel (matches SliceMaster format with full device name)
    const daxRx = `DAX Audio RX ${daxChannel} (FlexRadio Systems DAX Audio)`;
    const daxTx = `DAX Audio TX (FlexRadio Systems DAX TX)`;  // All slices share same TX device
    configSection.set('SoundInName', daxRx);
    configSection.set('SoundOutName', daxTx);
    configSection.set('AudioInputChannel', 'Mono');
    configSection.set('AudioOutputChannel', 'Mono');

    // Set reasonable defaults matching SliceMaster
    configSection.set('RxBandwidth', '4500');
    configSection.set('Polling', '1');

    console.log(`  Rig: Ham Radio Deluxe`);
    console.log(`  CATNetworkPort: ${smartCatHost}:${smartCatPort}`);
    console.log(`  Audio In: ${daxRx}`);
    console.log(`  Audio Out: ${daxTx}`);

    // Write back
    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  Rig configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write rig config:`, error);
        return false;
    }
}

/**
 * Configure Rig/Radio settings for TS-2000 via virtual COM port
 * This configures WSJT-X to use "Kenwood TS-2000" rig type over serial
 */
export function configureRigForTs2000(
    rigName: string,
    config: Ts2000RigConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    const comPort = config.comPort;
    const daxChannel = config.daxChannel || 1;
    const baudRate = config.baudRate || 38400;

    console.log(`Configuring Rig for TS-2000 CAT (${rigName}):`);
    console.log(`  INI path: ${iniPath}`);
    console.log(`  COM Port: ${comPort}`);
    console.log(`  Baud Rate: ${baudRate}`);
    console.log(`  DAX Channel: ${daxChannel}`);

    // Ensure instance-specific config directory exists
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    // Ensure Configuration section exists
    if (!sections.has('Configuration')) {
        sections.set('Configuration', new Map());
    }

    const configSection = sections.get('Configuration')!;

    // Use "Kenwood TS-2000" rig type
    configSection.set('Rig', 'Kenwood TS-2000');

    // Serial port settings
    configSection.set('CATSerialPort', comPort);
    configSection.set('CATSerialPortParameters', `${baudRate},8,N,1,H,false,false`);

    // PTT method - CAT
    configSection.set('PTTMethod', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::PTTMethod\\0\\0\\0\\0\\xfPTT_method_CAT\\0)');

    // Split operation mode - None (or Rig for split)
    configSection.set('SplitMode', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::SplitMode\\0\\0\\0\\0\\x10split_mode_none\\0)');

    // Audio settings - DAX channel
    const daxRx = `DAX Audio RX ${daxChannel} (FlexRadio Systems DAX Audio)`;
    const daxTx = `DAX Audio TX (FlexRadio Systems DAX TX)`;
    configSection.set('SoundInName', daxRx);
    configSection.set('SoundOutName', daxTx);
    configSection.set('AudioInputChannel', 'Mono');
    configSection.set('AudioOutputChannel', 'Mono');

    // Set reasonable defaults
    configSection.set('RxBandwidth', '4500');
    configSection.set('Polling', '1');

    console.log(`  Rig: Kenwood TS-2000`);
    console.log(`  Serial: ${comPort} @ ${baudRate}`);
    console.log(`  Audio In: ${daxRx}`);
    console.log(`  Audio Out: ${daxTx}`);

    // Write back
    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  Rig configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write rig config:`, error);
        return false;
    }
}

/**
 * Configure Rig/Radio settings for TS-2000 via TCP Network Server
 * Per Rig-control.md: WSJT-X connects to localhost:60001-60004
 */
export function configureRigForNetworkCat(
    rigName: string,
    config: NetworkCatConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    const host = config.host;
    const port = config.port;
    const daxChannel = config.daxChannel || 1;

    console.log(`Configuring Rig for Network CAT (${rigName}):`);
    console.log(`  INI path: ${iniPath}`);
    console.log(`  Network Server: ${host}:${port}`);
    console.log(`  DAX Channel: ${daxChannel}`);

    // Ensure instance-specific config directory exists
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    if (!sections.has('Configuration')) {
        sections.set('Configuration', new Map());
    }

    const configSection = sections.get('Configuration')!;

    // Rig type: Kenwood TS-2000
    configSection.set('Rig', 'Kenwood TS-2000');

    // Network Server mode (not serial port)
    configSection.set('CATSerialPort', 'Network Server');
    configSection.set('CATNetworkPort', `${host}:${port}`);

    // PTT method - CAT
    configSection.set('PTTMethod', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::PTTMethod\\0\\0\\0\\0\\xfPTT_method_CAT\\0)');

    // Split operation mode - Rig (per Rig-control.md)
    configSection.set('SplitMode', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::SplitMode\\0\\0\\0\\0\\x0esplit_mode_rig\\0)');

    // Audio settings - DAX channel
    const daxRx = `DAX Audio RX ${daxChannel} (FlexRadio Systems DAX Audio)`;
    const daxTx = `DAX Audio TX (FlexRadio Systems DAX TX)`;
    configSection.set('SoundInName', daxRx);
    configSection.set('SoundOutName', daxTx);
    configSection.set('AudioInputChannel', 'Mono');
    configSection.set('AudioOutputChannel', 'Mono');

    // Set reasonable defaults
    configSection.set('RxBandwidth', '4500');
    configSection.set('Polling', '1');

    console.log(`  Rig: Kenwood TS-2000 (Network Server)`);
    console.log(`  Network: ${host}:${port}`);
    console.log(`  Audio In: ${daxRx}`);
    console.log(`  Audio Out: ${daxTx}`);

    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  Rig configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write rig config:`, error);
        return false;
    }
}

/**
 * Configure Rig/Radio settings for native FlexRadio SmartSDR Slice mode
 * Per updated Rig-control.md: Uses WSJT-X built-in "FlexRadio SmartSDR Slice A-F"
 * No TS-2000 emulation - native Flex slice support
 */
export function configureRigForFlexSlice(
    rigName: string,
    config: FlexSliceConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    const sliceIndex = config.sliceIndex;
    const catPort = config.catPort;
    const daxChannel = config.daxChannel || (sliceIndex + 1);
    const udpPort = config.udpPort || (2237 + sliceIndex);
    const hamlibRigId = FLEX_SLICE_HAMLIB_IDS[sliceIndex] || 1035;

    console.log(`Configuring Rig for FlexRadio Slice ${String.fromCharCode(65 + sliceIndex)} (${rigName}):`);
    console.log(`  INI path: ${iniPath}`);
    console.log(`  HamlibRig: ${hamlibRigId} (Flex Slice ${String.fromCharCode(65 + sliceIndex)})`);
    console.log(`  CAT Port: localhost:${catPort}`);
    console.log(`  DAX Channel: ${daxChannel}`);
    console.log(`  UDP Port: ${udpPort}`);

    // Ensure instance-specific config directory exists
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    if (!sections.has('Configuration')) {
        sections.set('Configuration', new Map());
    }

    const configSection = sections.get('Configuration')!;

    // Native FlexRadio SmartSDR Slice settings per Rig-control.md
    configSection.set('Rig', '1');
    configSection.set('HamlibRig', hamlibRigId.toString());
    configSection.set('CATPort', `localhost:${catPort}`);

    // PTT method - CAT
    configSection.set('PTTMethod', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::PTTMethod\\0\\0\\0\\0\\xfPTT_method_CAT\\0)');

    // Mode - Data/Pkt
    configSection.set('Mode', 'Data/Pkt');

    // Split operation mode - Rig
    configSection.set('SplitMode', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::SplitMode\\0\\0\\0\\0\\x0esplit_mode_rig\\0)');

    // UDP server settings (unique per instance)
    configSection.set('UDPServerPort', udpPort.toString());
    configSection.set('UDPServer', '127.0.0.1');
    configSection.set('AcceptUDPRequests', 'true');  // CRITICAL: Enable UDP control commands

    // Audio settings - DAX channel
    const daxRxFlex = `DAX Audio RX ${daxChannel} (FlexRadio Systems DAX Audio)`;
    const daxTxFlex = `DAX Audio TX (FlexRadio Systems DAX TX)`;
    configSection.set('SoundInName', daxRxFlex);
    configSection.set('SoundOutName', daxTxFlex);
    configSection.set('AudioInputChannel', 'Mono');
    configSection.set('AudioOutputChannel', 'Mono');

    // Set reasonable defaults
    configSection.set('RxBandwidth', '4500');
    configSection.set('Polling', '1');

    console.log(`  Rig: FlexRadio SmartSDR Slice ${String.fromCharCode(65 + sliceIndex)}`);
    console.log(`  Audio In: ${daxRxFlex}`);
    console.log(`  Audio Out: ${daxTxFlex}`);

    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  Rig configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write rig config:`, error);
        return false;
    }
}

/**
 * Configure Rig/Radio settings for HRD CAT (Ham Radio Deluxe protocol)
 * This is how SliceMaster works - WSJT-X uses "Ham Radio Deluxe" rig type
 * and connects to our HRD CAT server which translates to FlexRadio API
 *
 * Key points from SliceMaster architecture:
 * - WSJT-X connects as an "HRD client" to our TCP server
 * - We translate HRD commands (set frequency, mode, PTT) to FlexRadio API
 * - Bidirectional sync: WSJT-X tune -> slice moves, slice tune -> WSJT-X follows
 * - No SmartSDR CAT needed - our HRD TCP shim replaces it
 */
export function configureRigForHrdCat(
    rigName: string,
    config: HrdCatConfig
): boolean {
    const iniPath = getInstanceIniPath(rigName);
    const configDir = getInstanceConfigDir(rigName);

    const sliceIndex = config.sliceIndex;
    const catPort = config.catPort;
    const daxChannel = config.daxChannel || (sliceIndex + 1);
    const udpPort = config.udpPort || (2237 + sliceIndex);
    const sliceLetter = String.fromCharCode(65 + sliceIndex);
    const wideGraphConfig = config.wideGraph;

    console.log(`Configuring Rig for HRD CAT - Slice ${sliceLetter} (${rigName}):`);
    console.log(`  INI path: ${iniPath}`);
    console.log(`  Config folder: ${configDir}`);
    console.log(`  HRD CAT Port: localhost:${catPort}`);
    console.log(`  DAX Channel: ${daxChannel}`);
    console.log(`  UDP Port: ${udpPort}`);

    // Ensure instance-specific config directory exists (SliceMaster pattern)
    if (!fs.existsSync(configDir)) {
        console.log(`  Creating config folder: ${configDir}`);
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Always load from template to ensure valid configuration
    const sections = loadTemplateIni();

    if (!sections.has('Configuration')) {
        sections.set('Configuration', new Map());
    }

    const configSection = sections.get('Configuration')!;

    // Ham Radio Deluxe rig type - this is what SliceMaster uses
    configSection.set('Rig', 'Ham Radio Deluxe');

    // Network Server with our HRD CAT port
    configSection.set('CATNetworkPort', `127.0.0.1:${catPort}`);

    // IMPORTANT: Remove any conflicting settings from previous configurations
    // These would confuse WSJT-X if both HRD and native FlexRadio settings exist
    configSection.delete('HamlibRig');
    configSection.delete('CATPort');
    configSection.delete('CATSerialPort');
    configSection.delete('CATSerialPortParameters');

    // PTT method - CAT
    configSection.set('PTTMethod', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::PTTMethod\\0\\0\\0\\0\\xfPTT_method_CAT\\0)');

    // Split operation mode - None (HRD handles this)
    configSection.set('SplitMode', '@Variant(\\0\\0\\0\\x7f\\0\\0\\0\\x1eTransceiverFactory::SplitMode\\0\\0\\0\\0\\x10split_mode_none\\0)');

    // UDP server settings (unique per instance)
    configSection.set('UDPServerPort', udpPort.toString());
    configSection.set('UDPServer', '127.0.0.1');
    configSection.set('AcceptUDPRequests', 'true');

    // Audio settings - DAX channel
    const daxRx = `DAX Audio RX ${daxChannel} (FlexRadio Systems DAX Audio)`;
    const daxTx = `DAX Audio TX (FlexRadio Systems DAX TX)`;
    configSection.set('SoundInName', daxRx);
    configSection.set('SoundOutName', daxTx);
    configSection.set('AudioInputChannel', 'Mono');
    configSection.set('AudioOutputChannel', 'Mono');

    // Set reasonable defaults
    configSection.set('RxBandwidth', '4500');
    configSection.set('Polling', '1');

    // Station info (callsign and grid locator)
    if (config.callsign) {
        configSection.set('MyCall', config.callsign);
        console.log(`  Callsign: ${config.callsign}`);
    }
    if (config.grid) {
        configSection.set('MyGrid', config.grid);
        console.log(`  Grid: ${config.grid}`);
    }

    // CRITICAL MCP OPERATIONAL SETTINGS - ensure Monitor is enabled for audio
    configSection.set('MonitorOFF', 'false');  // CRITICAL: Monitor enabled for decoding
    configSection.set('MonitorLastUsed', 'false');

    // Ensure Common section exists for mode settings
    if (!sections.has('Common')) {
        sections.set('Common', new Map());
    }
    const commonSection = sections.get('Common')!;

    // Set critical operational defaults for MCP
    commonSection.set('Mode', 'FT8');           // Default mode
    commonSection.set('AutoSeq', 'true');       // Enable auto-sequence
    commonSection.set('RxAll', 'false');        // Don't show all messages (reduces noise)
    commonSection.set('SaveNone', 'true');      // Don't save audio files by default
    commonSection.set('NDepth', '3');           // Fast decode depth
    commonSection.set('RxFreq', '1500');        // Center frequency
    commonSection.set('TxFreq', '1500');        // Default TX frequency
    commonSection.set('HoldTxFreq', 'true');    // Hold TX frequency for automated QSO

    // Wide Graph overrides (apply here so the final INI includes them)
    if (!sections.has('WideGraph')) {
        sections.set('WideGraph', new Map());
    }
    const wideGraphSection = sections.get('WideGraph')!;
    if (wideGraphConfig) {
        if (wideGraphConfig.binsPerPixel !== undefined) {
            wideGraphSection.set('BinsPerPixel', wideGraphConfig.binsPerPixel.toString());
        }
        if (wideGraphConfig.startFreq !== undefined) {
            wideGraphSection.set('StartFreq', wideGraphConfig.startFreq.toString());
        }
        if (wideGraphConfig.plotZero !== undefined) {
            wideGraphSection.set('PlotZero', wideGraphConfig.plotZero.toString());
        }
        if (wideGraphConfig.plotGain !== undefined) {
            wideGraphSection.set('PlotGain', wideGraphConfig.plotGain.toString());
        }
        if (wideGraphConfig.plotWidth !== undefined) {
            wideGraphSection.set('PlotWidth', wideGraphConfig.plotWidth.toString());
        }
    }

    // HideControls lives in Configuration; remove stale geometry caches to respect runtime positioning
    if (wideGraphConfig?.hideControls !== undefined) {
        configSection.set('HideControls', wideGraphConfig.hideControls ? 'true' : 'false');
    }
    if (wideGraphSection.has('geometry')) {
        wideGraphSection.delete('geometry');
    }
    if (sections.has('MainWindow')) {
        const mainWindow = sections.get('MainWindow')!;
        if (mainWindow.has('geometry')) {
            mainWindow.delete('geometry');
        }
        if (mainWindow.has('geometryNoControls')) {
            mainWindow.delete('geometryNoControls');
        }
    }

    console.log(`  Rig: Ham Radio Deluxe`);
    console.log(`  Network: 127.0.0.1:${catPort}`);
    console.log(`  Audio In: ${daxRx}`);
    console.log(`  Audio Out: ${daxTx}`);
    console.log(`  Monitor: Enabled (MonitorOFF=false)`);
    console.log(`  Mode: FT8 with AutoSeq`)

    try {
        const content = serializeIni(sections);
        fs.writeFileSync(iniPath, content, 'utf-8');
        console.log(`  HRD CAT rig configuration saved successfully`);
        return true;
    } catch (error) {
        console.error(`  Failed to write HRD CAT rig config:`, error);
        return false;
    }
}
