import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WsjtxManager } from "../wsjtx/WsjtxManager";
import { FlexClient } from "../flex/FlexClient";
import { Config } from "../config";

export class WsjtxMcpServer {
    private server: McpServer;
    private wsjtxManager: WsjtxManager;
    private flexClient: FlexClient | null;
    private config: Config;

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
    }

    private setupTools() {
        // Tool: start_instance
        this.server.tool(
            "start_instance",
            "Start a new WSJT-X instance",
            {
                name: z.string().describe("Friendly name for the instance"),
                band: z.string().optional().describe("Target band (e.g., '20m')"),
                rigName: z.string().optional().describe("Rig name configuration"),
            },
            async ({ name, band, rigName }) => {
                if (this.config.mode !== 'STANDARD') {
                    return {
                        content: [{ type: "text" as const, text: "Error: Manual start_instance is only available in STANDARD mode." }],
                        isError: true,
                    };
                }

                try {
                    this.wsjtxManager.startInstance({ name, band, rigName });
                    return {
                        content: [{ type: "text" as const, text: `Started WSJT-X instance: ${name}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: stop_instance
        this.server.tool(
            "stop_instance",
            "Stop a running WSJT-X instance",
            {
                name: z.string().describe("Friendly name of the instance"),
            },
            async ({ name }) => {
                const success = this.wsjtxManager.stopInstance(name);
                if (success) {
                    return {
                        content: [{ type: "text" as const, text: `Stopped instance ${name}` }],
                    };
                } else {
                    return {
                        content: [{ type: "text" as const, text: `Instance ${name} not found` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: execute_qso
        this.server.tool(
            "execute_qso",
            "Execute an autonomous QSO with a target station",
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
                        content: [{ type: "text" as const, text: `Started autonomous QSO with ${targetCallsign}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // === Rig Control Tools (per Rig-control.md) ===

        // Tool: rig_get_state
        this.server.tool(
            "rig_get_state",
            "Get current state of all FlexRadio slices",
            {},
            async () => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                const slices = this.flexClient.getSlices();
                const state = slices.map((slice) => {
                    // Extract slice index from slice.id (e.g., "slice_0" -> 0)
                    const match = slice.id.match(/slice_(\d+)/);
                    const index = match ? parseInt(match[1]) : 0;
                    return {
                        id: String.fromCharCode(65 + index),  // A, B, C, D
                        index: index,
                        freq_hz: slice.frequency,
                        freq_mhz: (slice.frequency / 1e6).toFixed(6),
                        mode: slice.mode,
                        dax_rx_channel: slice.daxChannel || (index + 1),
                        is_active: slice.active
                    };
                });

                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ slices: state }, null, 2) }],
                };
            }
        );

        // Tool: rig_tune_slice
        this.server.tool(
            "rig_tune_slice",
            "Tune a slice to a specific frequency",
            {
                slice_index: z.number().min(0).max(3).describe("Slice index (0=A, 1=B, 2=C, 3=D)"),
                freq_hz: z.number().describe("Frequency in Hz (e.g., 14074000)"),
            },
            async ({ slice_index, freq_hz }) => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                try {
                    this.flexClient.tuneSlice(slice_index, freq_hz);
                    const freqMHz = (freq_hz / 1e6).toFixed(6);
                    return {
                        content: [{ type: "text" as const, text: `Tuned slice ${String.fromCharCode(65 + slice_index)} to ${freqMHz} MHz` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: rig_set_slice_mode
        this.server.tool(
            "rig_set_slice_mode",
            "Set the mode for a slice (e.g., DIGU for FT8/FT4)",
            {
                slice_index: z.number().min(0).max(3).describe("Slice index (0=A, 1=B, 2=C, 3=D)"),
                mode: z.string().describe("Mode (e.g., 'DIGU', 'USB', 'LSB', 'CW')"),
            },
            async ({ slice_index, mode }) => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                try {
                    this.flexClient.setSliceMode(slice_index, mode.toUpperCase());
                    return {
                        content: [{ type: "text" as const, text: `Set slice ${String.fromCharCode(65 + slice_index)} mode to ${mode.toUpperCase()}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: rig_set_tx_slice
        this.server.tool(
            "rig_set_tx_slice",
            "Designate a slice for TX (transmit)",
            {
                slice_index: z.number().min(0).max(3).describe("Slice index (0=A, 1=B, 2=C, 3=D)"),
            },
            async ({ slice_index }) => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                try {
                    this.flexClient.setSliceTx(slice_index, true);
                    return {
                        content: [{ type: "text" as const, text: `Set slice ${String.fromCharCode(65 + slice_index)} as TX slice` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: rig_emergency_stop
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

        // Tool: rig_configure_slice
        this.server.tool(
            "rig_configure_slice",
            "Configure a slice with frequency, mode, and optionally set as TX",
            {
                slice_index: z.number().min(0).max(3).describe("Slice index (0=A, 1=B, 2=C, 3=D)"),
                freq_hz: z.number().describe("Frequency in Hz"),
                mode: z.string().optional().describe("Mode (default: DIGU)"),
                make_tx: z.boolean().optional().describe("Set this slice as TX slice"),
            },
            async ({ slice_index, freq_hz, mode, make_tx }) => {
                if (!this.flexClient) {
                    return {
                        content: [{ type: "text" as const, text: "Error: Not connected to FlexRadio" }],
                        isError: true,
                    };
                }

                try {
                    this.flexClient.tuneSlice(slice_index, freq_hz);
                    this.flexClient.setSliceMode(slice_index, mode?.toUpperCase() || 'DIGU');
                    if (make_tx) {
                        this.flexClient.setSliceTx(slice_index, true);
                    }

                    const freqMHz = (freq_hz / 1e6).toFixed(6);
                    const sliceLetter = String.fromCharCode(65 + slice_index);
                    return {
                        content: [{
                            type: "text" as const,
                            text: `Configured slice ${sliceLetter}: ${freqMHz} MHz, ${mode?.toUpperCase() || 'DIGU'}${make_tx ? ', TX enabled' : ''}`
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

        // === WSJT-X Control Tools (via UDP protocol) ===

        // Tool: wsjtx_configure
        this.server.tool(
            "wsjtx_configure",
            "Configure WSJT-X instance settings (mode, RX offset, DX call/grid). Note: Cannot change dial frequency - use rig_tune_slice for that.",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                mode: z.string().optional().describe("Mode (e.g., 'FT8', 'FT4', 'JT65')"),
                rx_df: z.number().optional().describe("RX audio frequency offset in Hz"),
                dx_call: z.string().optional().describe("DX station callsign"),
                dx_grid: z.string().optional().describe("DX station grid locator"),
                tr_period: z.number().optional().describe("T/R period in seconds (15 for FT8, 7.5 for FT4)"),
            },
            async ({ instance_id, mode, rx_df, dx_call, dx_grid, tr_period }) => {
                try {
                    this.wsjtxManager.configureInstance(instance_id, {
                        mode,
                        rxDF: rx_df,
                        dxCall: dx_call,
                        dxGrid: dx_grid,
                        trPeriod: tr_period,
                    });

                    const changes: string[] = [];
                    if (mode) changes.push(`mode=${mode}`);
                    if (rx_df !== undefined) changes.push(`rx_df=${rx_df}Hz`);
                    if (dx_call) changes.push(`dx_call=${dx_call}`);
                    if (dx_grid) changes.push(`dx_grid=${dx_grid}`);
                    if (tr_period) changes.push(`tr_period=${tr_period}s`);

                    return {
                        content: [{ type: "text" as const, text: `Configured ${instance_id}: ${changes.join(', ') || 'no changes'}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_switch_config
        this.server.tool(
            "wsjtx_switch_config",
            "Switch WSJT-X to a named configuration profile. This can change band/frequency if the profile has different settings.",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                config_name: z.string().describe("Configuration profile name to switch to"),
            },
            async ({ instance_id, config_name }) => {
                try {
                    this.wsjtxManager.switchConfiguration(instance_id, config_name);
                    return {
                        content: [{ type: "text" as const, text: `Switched ${instance_id} to configuration: ${config_name}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_clear_decodes
        this.server.tool(
            "wsjtx_clear_decodes",
            "Clear decode windows in WSJT-X",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                window: z.number().min(0).max(2).optional().describe("Window to clear: 0=Band Activity, 1=Rx Frequency, 2=Both (default)"),
            },
            async ({ instance_id, window }) => {
                try {
                    this.wsjtxManager.clearDecodes(instance_id, (window ?? 2) as 0 | 1 | 2);
                    const windowNames = ['Band Activity', 'Rx Frequency', 'Both'];
                    return {
                        content: [{ type: "text" as const, text: `Cleared ${windowNames[window ?? 2]} window(s) on ${instance_id}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_halt_tx
        this.server.tool(
            "wsjtx_halt_tx",
            "Stop transmission in WSJT-X",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                auto_tx_only: z.boolean().optional().describe("If true, only stop auto-TX; if false, stop all TX (default: true)"),
            },
            async ({ instance_id, auto_tx_only }) => {
                try {
                    this.wsjtxManager.haltTx(instance_id, auto_tx_only ?? true);
                    return {
                        content: [{ type: "text" as const, text: `Halted TX on ${instance_id}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_set_free_text
        this.server.tool(
            "wsjtx_set_free_text",
            "Set free text message in WSJT-X",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                text: z.string().describe("Free text message to set"),
                send: z.boolean().optional().describe("If true, immediately transmit the message (default: false)"),
            },
            async ({ instance_id, text, send }) => {
                try {
                    this.wsjtxManager.setFreeText(instance_id, text, send ?? false);
                    return {
                        content: [{ type: "text" as const, text: `Set free text on ${instance_id}: "${text}"${send ? ' (transmitting)' : ''}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_reply_to_station
        this.server.tool(
            "wsjtx_reply_to_station",
            "Reply to a decoded station (simulates double-clicking a decode in WSJT-X)",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                time: z.number().describe("Decode time (milliseconds since midnight UTC)"),
                snr: z.number().describe("Signal-to-noise ratio in dB"),
                delta_time: z.number().describe("Time offset in seconds"),
                delta_frequency: z.number().describe("Audio frequency offset in Hz"),
                mode: z.string().describe("Mode (e.g., 'FT8', 'FT4')"),
                message: z.string().describe("The decoded message to reply to"),
            },
            async ({ instance_id, time, snr, delta_time, delta_frequency, mode, message }) => {
                try {
                    this.wsjtxManager.replyToStation(instance_id, time, snr, delta_time, delta_frequency, mode, message);
                    return {
                        content: [{ type: "text" as const, text: `Replying to: ${message}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_highlight_callsign
        this.server.tool(
            "wsjtx_highlight_callsign",
            "Highlight a callsign in the WSJT-X band activity window",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                callsign: z.string().describe("Callsign to highlight"),
                bg_color: z.object({
                    r: z.number().min(0).max(255),
                    g: z.number().min(0).max(255),
                    b: z.number().min(0).max(255),
                }).describe("Background color RGB"),
                fg_color: z.object({
                    r: z.number().min(0).max(255),
                    g: z.number().min(0).max(255),
                    b: z.number().min(0).max(255),
                }).describe("Foreground (text) color RGB"),
            },
            async ({ instance_id, callsign, bg_color, fg_color }) => {
                try {
                    this.wsjtxManager.highlightCallsign(instance_id, callsign, bg_color, fg_color);
                    return {
                        content: [{ type: "text" as const, text: `Highlighted ${callsign} on ${instance_id}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_set_location
        this.server.tool(
            "wsjtx_set_location",
            "Set the station's Maidenhead grid location in WSJT-X",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                grid: z.string().describe("Maidenhead grid locator (e.g., 'FN20', 'JN47')"),
            },
            async ({ instance_id, grid }) => {
                try {
                    this.wsjtxManager.setLocation(instance_id, grid);
                    return {
                        content: [{ type: "text" as const, text: `Set location on ${instance_id} to ${grid}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_set_frequency
        this.server.tool(
            "wsjtx_set_frequency",
            "Set dial frequency in WSJT-X. This tunes both WSJT-X and the radio (via CAT). Band changes automatically based on frequency.",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                freq_hz: z.number().describe("Dial frequency in Hz (e.g., 14074000 for 20m FT8, 7074000 for 40m FT8)"),
                mode: z.string().optional().describe("Optional radio mode (e.g., 'USB', 'DIGU')"),
            },
            async ({ instance_id, freq_hz, mode }) => {
                try {
                    this.wsjtxManager.setFrequency(instance_id, freq_hz, mode);
                    const freqMHz = (freq_hz / 1e6).toFixed(6);
                    const band = this.frequencyToBand(freq_hz);
                    return {
                        content: [{ type: "text" as const, text: `Set ${instance_id} to ${freqMHz} MHz (${band})${mode ? ` in ${mode} mode` : ''}` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // Tool: wsjtx_tune_band
        this.server.tool(
            "wsjtx_tune_band",
            "Tune WSJT-X to a specific band's default FT8 frequency",
            {
                instance_id: z.string().describe("WSJT-X instance ID (rig name)"),
                band: z.enum(['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m']).describe("Amateur radio band"),
                digital_mode: z.enum(['FT8', 'FT4']).optional().describe("Digital mode (default: FT8)"),
            },
            async ({ instance_id, band, digital_mode }) => {
                const freq = this.getBandFrequency(band, digital_mode || 'FT8');
                if (!freq) {
                    return {
                        content: [{ type: "text" as const, text: `Error: Unknown band ${band}` }],
                        isError: true,
                    };
                }

                try {
                    this.wsjtxManager.setFrequency(instance_id, freq);
                    const freqMHz = (freq / 1e6).toFixed(6);
                    return {
                        content: [{ type: "text" as const, text: `Tuned ${instance_id} to ${band} ${digital_mode || 'FT8'}: ${freqMHz} MHz` }],
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text" as const, text: `Error: ${error}` }],
                        isError: true,
                    };
                }
            }
        );

        // === New FSD v3 Tools ===

        // Tool: rig_get_state (FSD §11.1) - Get full MCP state
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

        // Tool: wsjtx_get_decodes (FSD §11.5) - Get recent decodes for a channel
        this.server.tool(
            "wsjtx_get_decodes",
            "Get recent decodes for a specific channel or all channels",
            {
                channel_index: z.number().min(0).max(3).optional().describe("Channel index (0-3). Omit for all channels."),
                since_ms: z.number().optional().describe("Time window in milliseconds (default: 30000 = 30 seconds)"),
            },
            async ({ channel_index, since_ms }) => {
                const timeWindow = since_ms ?? 30000;
                let decodes;

                if (channel_index !== undefined) {
                    decodes = this.wsjtxManager.getDecodes(channel_index, timeWindow);
                } else {
                    decodes = this.wsjtxManager.getAllDecodes(timeWindow);
                }

                // Format decodes for AI consumption
                const formatted = decodes.map(d => ({
                    timestamp: d.timestamp,
                    channel: d.slice_id,
                    rf_hz: d.rf_hz,
                    dial_hz: d.dial_hz,
                    snr_db: d.snr_db,
                    dt_sec: d.dt_sec,
                    call: d.call,
                    grid: d.grid,
                    is_cq: d.is_cq,
                    is_my_call: d.is_my_call,
                    message: d.raw_text,
                }));

                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({ decodes: formatted, count: formatted.length }, null, 2)
                    }],
                };
            }
        );

        // Tool: log_get_worked (FSD §11.6) - Check if station is worked
        this.server.tool(
            "log_get_worked",
            "Check if a station has been worked on a specific band and mode",
            {
                call: z.string().describe("Callsign to check"),
                band: z.string().describe("Band (e.g., '20m', '40m')"),
                mode: z.string().describe("Mode (e.g., 'FT8', 'FT4')"),
            },
            async ({ call, band, mode }) => {
                const worked = this.wsjtxManager.isWorked(call, band, mode);
                const entry = this.wsjtxManager.getStateManager().getWorkedEntry(call, band, mode);

                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            worked,
                            call,
                            band,
                            mode,
                            last_qso_time: entry?.last_qso_time || null,
                        }, null, 2)
                    }],
                };
            }
        );

        // Tool: rig_set_tx_channel (FSD §11.3) - Set TX channel
        this.server.tool(
            "rig_set_tx_channel",
            "Set which channel is designated for transmitting",
            {
                channel_index: z.number().min(0).max(3).describe("Channel index (0=A, 1=B, 2=C, 3=D)"),
            },
            async ({ channel_index }) => {
                try {
                    this.wsjtxManager.setTxChannel(channel_index);

                    // Also update FlexRadio if connected
                    if (this.flexClient) {
                        this.flexClient.setSliceTx(channel_index, true);
                    }

                    return {
                        content: [{
                            type: "text" as const,
                            text: `TX channel set to ${String.fromCharCode(65 + channel_index)}`
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

        // === Logbook Tools (FSD §8) ===

        // Tool: log_get_info - Get logbook information
        this.server.tool(
            "log_get_info",
            "Get logbook information including path and QSO count",
            {},
            async () => {
                const path = this.wsjtxManager.getLogbookPath();
                const count = this.wsjtxManager.getQsoCount();
                const state = this.wsjtxManager.getMcpState();

                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            logbook_path: path,
                            total_qsos: count,
                            last_updated: state.logbook.last_updated,
                        }, null, 2)
                    }],
                };
            }
        );

        // Tool: log_export - Export logbook to a new file
        this.server.tool(
            "log_export",
            "Export the logbook to a new ADIF file",
            {
                output_path: z.string().describe("Full path for the output ADIF file"),
            },
            async ({ output_path }) => {
                try {
                    this.wsjtxManager.exportLogbook(output_path);
                    return {
                        content: [{
                            type: "text" as const,
                            text: `Logbook exported to ${output_path}`
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

        // Tool: log_clear - Clear logbook (with backup)
        this.server.tool(
            "log_clear",
            "Clear the logbook (creates a timestamped backup first). Use with caution!",
            {
                confirm: z.boolean().describe("Must be true to confirm clearing the logbook"),
            },
            async ({ confirm }) => {
                if (!confirm) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: "Error: You must set confirm=true to clear the logbook"
                        }],
                        isError: true,
                    };
                }

                try {
                    this.wsjtxManager.clearLogbook();
                    return {
                        content: [{
                            type: "text" as const,
                            text: "Logbook cleared (backup created)"
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
    }

    /**
     * Convert frequency in Hz to band name
     */
    private frequencyToBand(freqHz: number): string {
        const freqMHz = freqHz / 1e6;
        if (freqMHz >= 1.8 && freqMHz < 2.0) return '160m';
        if (freqMHz >= 3.5 && freqMHz < 4.0) return '80m';
        if (freqMHz >= 5.3 && freqMHz < 5.5) return '60m';
        if (freqMHz >= 7.0 && freqMHz < 7.3) return '40m';
        if (freqMHz >= 10.1 && freqMHz < 10.15) return '30m';
        if (freqMHz >= 14.0 && freqMHz < 14.35) return '20m';
        if (freqMHz >= 18.068 && freqMHz < 18.168) return '17m';
        if (freqMHz >= 21.0 && freqMHz < 21.45) return '15m';
        if (freqMHz >= 24.89 && freqMHz < 24.99) return '12m';
        if (freqMHz >= 28.0 && freqMHz < 29.7) return '10m';
        if (freqMHz >= 50.0 && freqMHz < 54.0) return '6m';
        if (freqMHz >= 144.0 && freqMHz < 148.0) return '2m';
        return 'unknown';
    }

    /**
     * Get default FT8/FT4 frequency for a band
     */
    private getBandFrequency(band: string, mode: string): number | null {
        const ft8Frequencies: Record<string, number> = {
            '160m': 1840000,
            '80m': 3573000,
            '60m': 5357000,
            '40m': 7074000,
            '30m': 10136000,
            '20m': 14074000,
            '17m': 18100000,
            '15m': 21074000,
            '12m': 24915000,
            '10m': 28074000,
            '6m': 50313000,
            '2m': 144174000,
        };

        const ft4Frequencies: Record<string, number> = {
            '160m': 1840000,
            '80m': 3575000,
            '60m': 5357000,
            '40m': 7047500,
            '30m': 10140000,
            '20m': 14080000,
            '17m': 18104000,
            '15m': 21140000,
            '12m': 24919000,
            '10m': 28180000,
            '6m': 50318000,
            '2m': 144170000,
        };

        if (mode === 'FT4') {
            return ft4Frequencies[band] || null;
        }
        return ft8Frequencies[band] || null;
    }

    private setupResources() {
        // Resource: List instances (legacy)
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

        // Resource: Full MCP state (FSD §11.1)
        this.server.resource(
            "state",
            "wsjt-x://state",
            async (uri) => {
                const state = this.wsjtxManager.getMcpState();
                // Convert Map to object for JSON serialization
                const serializedState = {
                    ...state,
                    logbook: {
                        ...state.logbook,
                        entries: Object.fromEntries(state.logbook.entries),
                    },
                };
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify(serializedState, null, 2),
                        mimeType: "application/json",
                    }],
                };
            }
        );

        // Resource: Channel list (FSD §3)
        this.server.resource(
            "channels",
            "wsjt-x://channels",
            async (uri) => {
                const state = this.wsjtxManager.getMcpState();
                const channels = state.channels.map(ch => ({
                    id: ch.id,
                    index: ch.index,
                    freq_hz: ch.freq_hz,
                    band: ch.band,
                    mode: ch.wsjtx_mode || ch.mode,
                    is_tx: ch.is_tx,
                    status: ch.status,
                    connected: ch.connected,
                    last_decode_time: ch.last_decode_time,
                    decode_count: ch.decode_count,
                    qso_count: ch.qso_count,
                }));
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify({ channels, tx_channel: state.tx_channel_index }, null, 2),
                        mimeType: "application/json",
                    }],
                };
            }
        );

        // Resource: Recent decodes (FSD §7)
        this.server.resource(
            "decodes",
            "wsjt-x://decodes",
            async (uri) => {
                // Get decodes from last 60 seconds by default
                const decodes = this.wsjtxManager.getAllDecodes(60000);
                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify({ decodes, count: decodes.length }, null, 2),
                        mimeType: "application/json",
                    }],
                };
            }
        );

        // Resource: Logbook info (FSD §8)
        this.server.resource(
            "logbook",
            "wsjt-x://logbook",
            async (uri) => {
                const path = this.wsjtxManager.getLogbookPath();
                const count = this.wsjtxManager.getQsoCount();
                const state = this.wsjtxManager.getMcpState();

                return {
                    contents: [{
                        uri: uri.href,
                        text: JSON.stringify({
                            logbook_path: path,
                            total_qsos: count,
                            last_updated: state.logbook.last_updated,
                            worked_entries_count: state.logbook.entries.size,
                        }, null, 2),
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
