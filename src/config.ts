import { z } from 'zod';

export const OperationModeSchema = z.enum(['FLEX', 'STANDARD']);
export type OperationMode = z.infer<typeof OperationModeSchema>;

export const ConfigSchema = z.object({
    mode: OperationModeSchema.default('STANDARD'),
    flex: z.object({
        host: z.string().default('255.255.255.255'), // Broadcast discovery
        port: z.number().default(4992),
    }),
    standard: z.object({
        rigName: z.string().default('IC-7300'),
        rigPort: z.string().optional(), // e.g., COM3
    }),
    mcp: z.object({
        name: z.string().default('wsjt-x-mcp'),
        version: z.string().default('1.0.0'),
    }),
    web: z.object({
        port: z.number().default(3000),
    })
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
    // In a real app, we'd load from a file or env vars.
    // For now, we'll use defaults or simple env overrides.
    const mode = (process.env.WSJTX_MODE?.toUpperCase() === 'FLEX') ? 'FLEX' : 'STANDARD';

    return ConfigSchema.parse({
        mode,
        flex: {
            host: process.env.FLEX_HOST,
        },
        standard: {
            rigName: process.env.RIG_NAME,
            rigPort: process.env.RIG_PORT,
        }
    });
}
