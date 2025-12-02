import { loadConfig } from './SettingsManager';
import { FlexClient } from './flex/FlexClient';
import { discoverFlexRadio } from './flex/FlexDiscovery';
import { WsjtxManager } from './wsjtx/WsjtxManager';
import { WsjtxMcpServer } from './mcp/McpServer';
import { WebServer } from './web/server';
import { setDefaultWsjtxPath, killOrphanedJt9Processes } from './wsjtx/ProcessManager';

async function main() {
    console.log('Starting WSJT-X MCP Server...');

    try {
        // Clean up any orphaned jt9 processes from previous sessions
        await killOrphanedJt9Processes();

        const config = loadConfig();
        console.log(`Operation Mode: ${config.mode}`);

        // Set WSJT-X path from config
        if (config.wsjtx?.path) {
            setDefaultWsjtxPath(config.wsjtx.path);
            console.log(`WSJT-X Path: ${config.wsjtx.path}`);
        }

        const wsjtxManager = new WsjtxManager(config);
        const webServer = new WebServer(config, wsjtxManager);

        let flexClient: FlexClient | null = null;

        // If in Flex Mode, auto-discover radio and connect BEFORE starting MCP
        if (config.mode === 'FLEX') {
            // Auto-discover FlexRadio on the network
            console.log('Discovering FlexRadio on the network...');
            const discoveredRadio = await discoverFlexRadio(5000);

            let flexHost = config.flex.host;
            if (discoveredRadio) {
                flexHost = discoveredRadio.ip;
                console.log(`Auto-discovered FlexRadio: ${discoveredRadio.model || 'Unknown'} at ${flexHost}`);
            } else {
                console.log(`No FlexRadio discovered, using configured host: ${flexHost}`);
            }

            // Create FlexClient with discovered or configured host
            const flexConfig = { ...config.flex, host: flexHost };
            flexClient = new FlexClient(flexConfig);

            wsjtxManager.setFlexClient(flexClient);

            // Handle FlexClient errors gracefully - don't crash the server
            flexClient.on('error', (error: Error) => {
                console.error('FlexRadio connection error (will retry):', error.message);
            });

            // Try to connect, but don't fail if radio isn't available
            try {
                await flexClient.connect();
            } catch (error) {
                console.warn('Could not connect to FlexRadio - will retry when available');
            }
        }

        // Create MCP server with optional FlexClient (for rig control tools)
        const mcpServer = new WsjtxMcpServer(wsjtxManager, config, flexClient || undefined);

        // Start WSJT-X Manager
        await wsjtxManager.start();

        // Start MCP Server
        await mcpServer.start();

        // Start Web Dashboard
        webServer.start();

        // Handle shutdown
        process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            if (flexClient) {
                await flexClient.disconnect();
            }
            await wsjtxManager.stop();
            // Clean up any remaining jt9 processes
            await killOrphanedJt9Processes();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start server:', error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
