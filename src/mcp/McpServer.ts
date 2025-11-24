import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WsjtxManager } from "../wsjtx/WsjtxManager";
import { Config } from "../config";

export class WsjtxMcpServer {
    private server: McpServer;
    private wsjtxManager: WsjtxManager;
    private config: Config;

    constructor(wsjtxManager: WsjtxManager, config: Config) {
        this.wsjtxManager = wsjtxManager;
        this.config = config;

        this.server = new McpServer({
            name: config.mcp.name,
            version: config.mcp.version,
        });
        await this.server.connect(transport);
        console.error("MCP Server started on stdio");
    }
}
