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

        this.setupTools();
        this.setupResources();
    }

    private setupTools() {
        // Tool: start_instance
        this.server.tool(
            "start_instance",
            {
                band: z.string().describe("Target band (e.g., '20m')"),
                rig: z.string().optional().describe("Rig name configuration"),
            },
            async ({ band, rig }) => {
                if (this.config.mode !== 'STANDARD') {
                    return {
                        content: [{ type: "text", text: "Error: Manual start_instance is only available in STANDARD mode." }],
                        isError: true,
                    };
                }
                // TODO: Call wsjtxManager.startInstance(band, rig)
                return {
                    content: [{ type: "text", text: `Started WSJT-X for ${band}` }],
                };
            }
        );

        // Tool: stop_instance
        this.server.tool(
            "stop_instance",
            {
                name: z.string().describe("Friendly name of the instance"),
            },
            async ({ name }) => {
                // TODO: Call wsjtxManager.stopInstance(name)
                return {
                    content: [{ type: "text", text: `Stopped instance ${name}` }],
                };
            }
        );
    }

    private setupResources() {
        // Resource: List instances
        this.server.resource(
            "instances",
            "wsjt-x://instances",
            async (uri) => {
                // TODO: Get instances from wsjtxManager
                const instances = [
                    { name: "20m", status: "Running", freq: "14.074" }
                ];
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify(instances, null, 2),
                        mimeType: "application/json",
                    }],
                };
            }
        );
    }

    public async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("MCP Server started on stdio");
    }
}
