import { loadConfig } from './config';
import { FlexClient } from './flex/FlexClient';
import { WsjtxManager } from './wsjtx/WsjtxManager';
import { WsjtxMcpServer } from './mcp/McpServer';
import { WebServer } from './web/server';

async function main() {
    console.log('Starting WSJT-X MCP Server...');

    try {
        const config = loadConfig();
        console.log(`Operation Mode: ${config.mode}`);

        const flexClient = new FlexClient(config.flex);
        const wsjtxManager = new WsjtxManager(config);
        const mcpServer = new WsjtxMcpServer(wsjtxManager, config);
        const webServer = new WebServer(config, wsjtxManager);

        // Start WSJT-X Manager
        await wsjtxManager.start();

        // Start MCP Server
        await mcpServer.start();

        // Start Web Dashboard
        webServer.start();

        // If in Flex Mode, connect to radio
        if (config.mode === 'FLEX') {
            await flexClient.connect();
        }

        // Handle shutdown
        process.on('SIGINT', async () => {
            console.log('\nShutting down...');
            await flexClient.disconnect();
            await wsjtxManager.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

main();
