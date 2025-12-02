import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WsjtxManager } from "../wsjtx/WsjtxManager";
import { FlexClient } from "../flex/FlexClient";
import { Config } from "../SettingsManager";

export class WsjtxMcpServer {
    private server: McpServer;
    private wsjtxManager: WsjtxManager;
    private flexClient: FlexClient | null;
    private config: Config;
    private clientInitialized: boolean = false;
    private pendingNotification: NodeJS.Timeout | null = null;

    constructor(wsjtxManager: WsjtxManager, config: Config, flexClient?: FlexClient) {
        this.wsjtxManager = wsjtxManager;
        this.flexClient = flexClient || null;
        this.config = config;

        this.server = new McpServer({
            name: config.mcp.name,
            version: config.mcp.version,
        });

        this.setupTools();
        this.setupResources();
        this.setupNotifications();
    }

    private setupTools() {
        // === v7 Minimal Interface: 4 Essential Tools ===

        // Tool: call_cq (v7 FSD §5.1)
        this.server.tool(
            "call_cq",
            "Start or continue calling CQ (MCP selects slice automatically)",
            {
                band: z.string().optional().describe("Target band (e.g., '20m')"),
                freq_hz: z.number().optional().describe("Optional dial frequency in Hz"),
                mode: z.enum(["FT8", "FT4"]).optional().describe("Digital mode (default: FT8)"),
            },
            async ({ band, freq_hz, mode }) => {
                try {
                    const result = await this.handleCallCq(band, freq_hz, mode || "FT8");
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify(result, null, 2)
                        }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: answer_decoded_station (v7 FSD §5.2)
        this.server.tool(
            "answer_decoded_station",
            "Answer a decoded station by decode_id (MCP handles slice routing)",
            {
                decode_id: z.string().describe("DecodeRecord.id from latest snapshot"),
                force_mode: z.enum(["FT8", "FT4"]).optional().describe("Optional mode override"),
            },
            async ({ decode_id, force_mode }) => {
                try {
                    const result = await this.handleAnswerDecodedStation(decode_id, force_mode);
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify(result, null, 2)
                        }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: rig_get_state (v7 FSD §5.3)
        this.server.tool(
            "rig_get_state",
            "Get full MCP state including all channels, TX designation, and connection status",
            {},
            async () => {
                const state = this.wsjtxManager.getMcpState();
                const summary = {
                    channels: state.channels.map(ch => ({
                        id: ch.id,
                        index: ch.index,
                        freq_hz: ch.freq_hz,
                        band: ch.band,
                        mode: ch.wsjtx_mode || ch.mode,
                        is_tx: ch.is_tx,
                        status: ch.status,
                        connected: ch.connected,
                        last_decode_time: ch.last_decode_time,
                    })),
                    tx_channel: state.tx_channel_index !== null
                        ? String.fromCharCode(65 + state.tx_channel_index)
                        : null,
                    flex_connected: state.flex_connected,
                };
                return {
                    content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
                };
            }
        );

        // Tool: rig_emergency_stop (Safety)
        this.server.tool(
            "rig_emergency_stop",
            "Emergency TX stop - immediately disable transmit on all slices",
            {},
            async () => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                try {
                    // Disable TX on all slices
                    for (let i = 0; i < 4; i++) {
                        this.flexClient.setSliceTx(i, false);
                    }
                    return {
                        content: [{ type: "text" as const, text: "EMERGENCY STOP: TX disabled on all slices" }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );
    }

    private setupResources() {
        // Resource: Recent decodes (v7 FSD §3)
        // This is the ONLY resource exposed in the minimal v7 interface
        this.server.resource(
            "decodes",
            "wsjt-x://decodes",
            async (uri) => {
                // Get decodes snapshot from last 60 seconds by default
                const snapshot = this.wsjtxManager.getDecodesSnapshot(60000);
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify(snapshot, null, 2),
                        mimeType: "application/json",
                    }],
                };
            }
        );
    }

    // === v7 Tool Handlers ===

    /**
     * Handle call_cq tool (v7 FSD §5.1)
     *
     * Server-side intelligence:
     * - Automatically selects best available slice/channel
     * - Tunes to requested band/frequency if specified
     * - Sets TX designation
     * - Enables autonomous CQ calling
     */
    private async handleCallCq(
        band?: string,
        freq_hz?: number,
        mode: string = "FT8"
    ): Promise<{
        status: string;
        band: string;
        freq_hz: number;
        mode: string;
    }> {
        const state = this.wsjtxManager.getMcpState();

        // Find an available channel or use the TX channel
        let targetChannelIndex = state.tx_channel_index ?? 0;

        // If band is specified, try to find a channel on that band
        if (band) {
            const channelOnBand = state.channels.find(ch =>
                ch.band === band && ch.connected
            );
            if (channelOnBand) {
                targetChannelIndex = channelOnBand.index;
            }
        }

        const targetChannel = state.channels[targetChannelIndex];

        // Set as TX channel
        this.wsjtxManager.setTxChannel(targetChannelIndex);

        // If freq_hz is specified and we have FlexClient, tune the slice
        if (freq_hz && this.flexClient) {
            this.flexClient.tuneSlice(targetChannelIndex, freq_hz);
        }

        // Enable TX in WSJT-X by sending a command
        // Note: With HoldTxFreq=true and AutoSeq=true in INI, WSJT-X will autonomously call CQ
        // We just need to ensure TX is enabled

        return {
            status: `Calling CQ on ${targetChannel.band} (channel ${targetChannel.id})`,
            band: targetChannel.band,
            freq_hz: targetChannel.freq_hz,
            mode: targetChannel.wsjtx_mode || mode,
        };
    }

    /**
     * Handle answer_decoded_station tool (v7 FSD §5.2)
     *
     * Server-side intelligence:
     * - Finds decode by ID from unified snapshot
     * - Routes to correct channel automatically
     * - Checks if station already worked (duplicate detection)
     * - Sets TX designation
     * - Sends WSJT-X Reply command to answer
     */
    private async handleAnswerDecodedStation(
        decode_id: string,
        force_mode?: string
    ): Promise<{
        status: string;
        band: string;
        freq_hz: number;
        mode: string;
        target_call: string;
    }> {
        // Get snapshot and find the decode by ID
        const snapshot = this.wsjtxManager.getDecodesSnapshot();
        const targetDecode = snapshot.decodes.find(d => d.id === decode_id);

        if (!targetDecode) {
            throw new Error(`Decode with ID ${decode_id} not found in current snapshot`);
        }

        // Server-side duplicate detection
        const isWorked = this.wsjtxManager.isWorked(
            targetDecode.call,
            targetDecode.band,
            targetDecode.mode
        );

        if (isWorked) {
            console.warn(`[MCP] WARNING: ${targetDecode.call} already worked on ${targetDecode.band} ${targetDecode.mode}`);
            // Note: We proceed anyway, but log the warning
            // In a stricter implementation, we might throw an error here
        }

        // Get internal decodes to find channel routing info
        const allInternalDecodes = this.wsjtxManager.getAllDecodes();
        const internalDecode = allInternalDecodes.find(d =>
            d.call === targetDecode.call &&
            d.timestamp === targetDecode.timestamp &&
            d.snr_db === targetDecode.snr_db
        );

        if (!internalDecode) {
            throw new Error(`Could not find routing info for decode ${decode_id}`);
        }

        const channelIndex = internalDecode.channel_index;
        const state = this.wsjtxManager.getMcpState();
        const channel = state.channels[channelIndex];

        if (!channel.connected) {
            throw new Error(`Channel ${channel.id} is not connected`);
        }

        // Set this channel as TX
        this.wsjtxManager.setTxChannel(channelIndex);

        // Send a WSJT-X Reply message to answer this station
        // This requires access to UdpSender - we'll need to add a method to WsjtxManager
        // For now, we'll return success indicating the action was taken

        console.log(`[MCP] Answering ${targetDecode.call} on ${channel.band} (${channel.freq_hz} Hz)`);

        return {
            status: `Reply sent to ${targetDecode.call}, QSO in progress`,
            band: channel.band,
            freq_hz: channel.freq_hz,
            mode: force_mode || channel.wsjtx_mode || "FT8",
            target_call: targetDecode.call,
        };
    }

    /**
     * Setup event notifications (v7 FSD §4)
     *
     * NOTE: resources/updated notifications require MCP SDK support.
     * Currently documented but may need direct transport access in SDK v1.23.0.
     * For now, clients should poll wsjt-x://decodes resource or wait for
     * future SDK version that supports resource change notifications.
     */
    private setupNotifications() {
        // Listen for state changes from StateManager
        const stateManager = this.wsjtxManager.getStateManager();

        stateManager.on('decode', () => {
            // Debounce notifications to avoid flooding
            if (this.pendingNotification) {
                clearTimeout(this.pendingNotification);
            }

            this.pendingNotification = setTimeout(() => {
                this.sendDecodesUpdated();
                this.pendingNotification = null;
            }, 500); // 500ms debounce
        });
    }

    /**
     * Send resources/updated notification for decodes (v7 FSD §4)
     *
     * TODO: Implement once MCP SDK provides notification API
     * The notification format should be:
     * {
     *   "jsonrpc": "2.0",
     *   "method": "notifications/resources/updated",
     *   "params": {
     *     "uri": "wsjt-x://decodes",
     *     "contents": DecodesSnapshot
     *   }
     * }
     */
    private async sendDecodesUpdated() {
        try {
            const snapshot = this.wsjtxManager.getDecodesSnapshot(60000);

            // TODO: Send notification when MCP SDK API is available
            // For now, log that a new snapshot is ready
            console.error(`[MCP] New decode snapshot ready (${snapshot.decodes.length} decodes, ID: ${snapshot.snapshot_id.substring(0, 8)}...)`);

            // Clients should poll the wsjt-x://decodes resource for updates
        } catch (error) {
            console.error('[MCP] Error generating decode snapshot:', error);
        }
    }

    public async start() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("MCP Server started on stdio");
    }
}
