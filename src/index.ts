import { loadConfig } from './config';
import { FlexClient } from './flex/FlexClient';
import { WsjtxManager } from './wsjtx/WsjtxManager';
import { WsjtxMcpServer } from './mcp/McpServer';
import { WebServer } from './web/server';

async function main() {
    console.log('Starting WSJT-X MCP Server...');
    process.exit(0);
});

    } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
}
}

main();
