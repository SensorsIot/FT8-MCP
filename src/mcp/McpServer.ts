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
                name: z.string().describe("Friendly name for the instance"),
                band: z.string().optional().describe("Target band (e.g., '20m')"),
                rigName: z.string().optional().describe("Rig name configuration"),
            },
            async ({ name, band, rigName }) => {
                if (this.config.mode !== 'STANDARD') {
                    return {
                        content: [{ type: "text", text: "Error: Manual start_instance is only available in STANDARD mode." }],
                        isError: true,
                    };
                }

                try {
                    this.wsjtxManager.startInstance({ name, band, rigName });
                    return {
                        content: [{ type: "text", text: `Started WSJT-X instance: ${name}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: stop_instance
        this.server.tool(
            "stop_instance",
            {
                name: z.string().describe("Friendly name of the instance"),
            },
            async ({ name }) => {
                const success = this.wsjtxManager.stopInstance(name);
                if (success) {
                    return {
                        content: [{ type: "text", text: `Stopped instance ${name}` }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: `Instance ${name} not found` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: execute_qso
        this.server.tool(
            "execute_qso",
            {
                instanceId: z.string().describe("Instance ID (rig name)"),
                targetCallsign: z.string().describe("Target station callsign"),
                myCallsign: z.string().describe("Your callsign"),
                myGrid: z.string().describe("Your grid locator (e.g., 'FN20')"),
            },
            async ({ instanceId, targetCallsign, myCallsign, myGrid }) => {
                try {
                    this.wsjtxManager.executeQso(instanceId, targetCallsign, myCallsign, myGrid);
                    return {
                        content: [{ type: "text", text: `Started autonomous QSO with ${targetCallsign}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );
    }

    private setupResources() {
        // Resource: List instances
        this.server.resource(
            "instances",
            "wsjt-x://instances",
            async (uri) => {
                const instances = this.wsjtxManager.getInstances();
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
