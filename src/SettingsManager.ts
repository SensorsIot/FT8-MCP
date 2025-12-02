import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export const OperationModeSchema = z.enum(['FLEX', 'STANDARD']);
export type OperationMode = z.infer<typeof OperationModeSchema>;

// Station status priority (higher = more important, used for hierarchical coloring)
export const StationStatusSchema = z.enum([
    'worked',      // Already in log (lowest priority - gray)
    'normal',      // Normal station (default)
    'weak',        // Weak signal (below threshold)
    'strong',      // Strong signal (above threshold)
    'priority',    // Contest priority (placeholder for future)
    'new_dxcc',    // New DXCC (placeholder for future)
]);
export type StationStatus = z.infer<typeof StationStatusSchema>;

export const ConfigSchema = z.object({
    // Common parameters
    mode: OperationModeSchema.default('STANDARD'),
    wsjtx: z.object({
        path: z.string().default('C:\\WSJT\\wsjtx\\bin\\wsjtx.exe'),
    }),
    station: z.object({
        callsign: z.string().default(''),
        grid: z.string().default(''),
        continent: z.string().default('NA'),        // "EU", "NA", "SA", "AF", "AS", "OC", "AN"
        dxcc: z.string().default(''),               // e.g. "HB9", "W", "K"
        prefixes: z.array(z.string()).default([]),  // All known prefixes for this station
    }),
    // Standard mode parameters
    standard: z.object({
        rigName: z.string().default('IC-7300'),
    }),
    // FlexRadio mode parameters
    flex: z.object({
        host: z.string().default('127.0.0.1'),
        catBasePort: z.number().default(60000), // SmartCAT TCP port (increments per slice)
        // Default FT8 dial frequencies for each slice (in Hz)
        // Slice A=index 0, B=index 1, etc.
        defaultBands: z.array(z.number()).optional(), // e.g., [28074000, 21074000, 14074000, 7074000]
    }),
    // Dashboard station tracking settings
    dashboard: z.object({
        stationLifetimeSeconds: z.number().default(120), // How long to show stations after last decode
        snrWeakThreshold: z.number().default(-15),       // SNR below this = weak
        snrStrongThreshold: z.number().default(0),       // SNR above this = strong
        adifLogPath: z.string().default(''),             // Path to combined ADIF log file
        colors: z.object({
            worked: z.string().default('#6b7280'),       // gray-500
            normal: z.string().default('#3b82f6'),       // blue-500
            weak: z.string().default('#eab308'),         // yellow-500
            strong: z.string().default('#22c55e'),       // green-500
            priority: z.string().default('#f97316'),     // orange-500
            new_dxcc: z.string().default('#ec4899'),     // pink-500
        }).optional(),
    }).optional(),
    // Logbook settings
    logbook: z.object({
        path: z.string().optional(),                     // Path to ADIF logbook (default: %APPDATA%/wsjt-x-mcp/mcp_logbook.adi)
        enableHrdServer: z.boolean().default(false),     // Enable HRD server for external loggers (Log4OM, N1MM)
        hrdPort: z.number().default(7800),               // HRD server port for external loggers
        udpRebroadcast: z.object({                       // UDP rebroadcast for external loggers (Log4OM)
            enabled: z.boolean().default(false),         // Enable UDP rebroadcast
            port: z.number().default(2241),              // Rebroadcast port (Log4OM listens here)
            instanceId: z.string().default('WSJT-X-MCP'), // Unified instance ID
            host: z.string().default('127.0.0.1'),       // Target host
        }).optional(),
    }).optional(),
    // Internal parameters (not user-configurable)
    mcp: z.object({
        name: z.string().default('wsjt-x-mcp'),
        version: z.string().default('1.0.0'),
    }),
    web: z.object({
        port: z.number().default(3000),
    })
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

export function loadConfig(): Config {
    let fileConfig = {};

    // Try to load from config file
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const fileContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
            fileConfig = JSON.parse(fileContent);
            console.log('Loaded config from config.json');
        } catch (error) {
            console.error('Error loading config.json:', error);
        }
    }

    // Merge with env vars (env vars take precedence)
    const mode = process.env.WSJTX_MODE?.toUpperCase() === 'FLEX' ? 'FLEX' :
                 (fileConfig as any)?.mode || 'STANDARD';

    return ConfigSchema.parse({
        ...fileConfig,
        mode,
        flex: {
            ...((fileConfig as any)?.flex || {}),
            host: process.env.FLEX_HOST || (fileConfig as any)?.flex?.host,
        },
        standard: {
            ...((fileConfig as any)?.standard || {}),
            rigName: process.env.RIG_NAME || (fileConfig as any)?.standard?.rigName,
            rigPort: process.env.RIG_PORT || (fileConfig as any)?.standard?.rigPort,
        },
        wsjtx: (fileConfig as any)?.wsjtx || {},
        station: (fileConfig as any)?.station || {},
        dashboard: (fileConfig as any)?.dashboard || {},
        logbook: (fileConfig as any)?.logbook || {},
        mcp: (fileConfig as any)?.mcp || {},
        web: (fileConfig as any)?.web || {}
    });
}

// Config change categories
export type ConfigChangeLevel = 'live' | 'wsjtx_restart' | 'app_restart';

export interface ConfigChangeResult {
    config: Config;
    changeLevel: ConfigChangeLevel;
    changedFields: string[];
}

// Determine what level of restart is needed for a config change
function getChangeLevel(oldConfig: any, newConfig: any, path: string = ''): { level: ConfigChangeLevel; fields: string[] } {
    // Fields that require full app restart
    const appRestartFields = ['mode', 'web.port', 'flex.host'];

    // Fields that require WSJT-X instance restart (INI file changes)
    const wsjtxRestartFields = ['wsjtx.path', 'flex.catBasePort', 'flex.defaultBands', 'standard.rigName'];

    // All other fields can be applied live

    let maxLevel: ConfigChangeLevel = 'live';
    const changedFields: string[] = [];

    function compare(oldVal: any, newVal: any, currentPath: string) {
        if (typeof newVal === 'object' && newVal !== null && !Array.isArray(newVal)) {
            for (const key of Object.keys(newVal)) {
                compare(oldVal?.[key], newVal[key], currentPath ? `${currentPath}.${key}` : key);
            }
        } else {
            // Check if value actually changed
            const oldStr = JSON.stringify(oldVal);
            const newStr = JSON.stringify(newVal);
            if (oldStr !== newStr) {
                changedFields.push(currentPath);

                if (appRestartFields.includes(currentPath)) {
                    maxLevel = 'app_restart';
                } else if (wsjtxRestartFields.includes(currentPath) && maxLevel !== 'app_restart') {
                    maxLevel = 'wsjtx_restart';
                }
            }
        }
    }

    compare(oldConfig, newConfig, '');
    return { level: maxLevel, fields: changedFields };
}

export function saveConfig(config: Partial<Config>): ConfigChangeResult {
    let existingConfig = {};

    if (fs.existsSync(CONFIG_FILE)) {
        try {
            existingConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        } catch (error) {
            // Ignore
        }
    }

    const mergedConfig = { ...existingConfig, ...config };

    // Determine what changed
    const { level, fields } = getChangeLevel(existingConfig, mergedConfig, '');

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(mergedConfig, null, 2));
    console.log('Config saved to config.json');
    if (fields.length > 0) {
        console.log(`  Changed fields: ${fields.join(', ')}`);
        console.log(`  Change level: ${level}`);
    }

    return {
        config: ConfigSchema.parse(mergedConfig),
        changeLevel: level,
        changedFields: fields
    };
}

export function getConfigFilePath(): string {
    return CONFIG_FILE;
}
