# MCP for wsjt-x
Multi-Slice Rig, Decode, and Logging Control Framework  
Functional Specification Document (FSD) – Code-Ready Version

This document defines a complete architecture and specification for a **Multi‑Slice Control Platform (MCP)** designed to let an AI:

- Select the **best available contact** across up to **4 slices/bands**.
- Set and **lock the transmitting frequency**.
- Command WSJT‑X to **call**, **complete a QSO**, and **log it**.
- Maintain its **own logbook** and keep an **external logger** (e.g. Log4OM) in sync.
- Start and supervise **one WSJT‑X instance per slice**.
- Avoid calling stations already worked on the **same band & mode** (FT8 / FT4).
- Operate mainly on **Windows**, later portable to **Linux/x86 and Raspberry Pi**.

MCP acts as a **single point of contact** for:

- WSJT‑X instances  
- The FlexRadio (SmartSDR v4.x API)  
- External logbook software (e.g. Log4OM)

The specification is written so that an AI can implement MCP without needing external documentation.

The system is TCP/UDP based. **No serial port emulation (COM ports) is used.**

---

# 1. Core Purpose

MCP is a daemon/service that:

1. Controls up to **4 Flex slices** (A–D), each representing a **channel**.  
2. Launches and manages **4 WSJT‑X instances**, one per channel.  
3. Aggregates **all decodes** from all WSJT‑X instances.  
4. Lets an AI choose which station to call, on which band, on which slice.  
5. Commands WSJT‑X (via rig control and, later, WSJT‑X UDP) to **TX / RX**.  
6. Logs QSOs in a **local ADIF logbook** and **forwards enriched QSOs** to an external logger.  
7. Ensures that **already-worked stations** (per band/mode) are not called again unless explicitly allowed.

MCP is designed as the **control brain**; WSJT‑X, Flex, and Log4OM become **I/O devices** from the AI’s perspective.

---

# 2. High-Level Architecture

                                         ┌─────────────────────────────┐
                                         │           AI / LLM          │
                                         │   (Tools / REST → MCP)      │
                                         └──────────────▲──────────────┘
                                                        │
                                                        │
                                                        ▼
    
      ┌──────────────────────────────────────────────────────────────────────────┐
      │                                   MCP                                    │
      │                 Multi-Slice Control Platform (Central Hub)               │
      │                                                                          │
      │   • Flex Backend (SmartSDR v4.x)                                         │
      │   • Channel Manager (Slices A–D)                                         │
      │   • WSJT-X Launcher + INI Builder                                        │
      │   • HRD Servers (4 WSJT-X + 1 Logger)                                    │
      │   • UDP Decode Aggregator                                                │
      │   • WorkedIndex / Duplicate Detector                                     │
      │   • ADIF Logbook Writer                                                  │
      │   • REST / LLM Tool Interface                                            │
      └───────────────▲──────────────────────────────────────────────▲──────────┘
                      │                                              │
                      │ HRD TCP + UDP                                │ Flex API
                      │                                              │
                      │                                              │
    
     ┌────────────────┴─────────────┐                    ┌────────────┴────────────────┐
     │           WSJT-X A           │                    │        Flex Slice A         │
     │    (Instance for Slice A)    │◀──────────────────▶│    (Freq / Mode / PTT)      │
     └──────────────────────────────┘                    └──────────────────────────────┘
    
     ┌──────────────────────────────┐                    ┌──────────────────────────────┐
     │           WSJT-X B           │                    │        Flex Slice B         │
     │    (Instance for Slice B)    │◀──────────────────▶│    (Freq / Mode / PTT)      │
     └──────────────────────────────┘                    └──────────────────────────────┘
    
     ┌──────────────────────────────┐                    ┌──────────────────────────────┐
     │           WSJT-X C           │                    │        Flex Slice C         │
     │    (Instance for Slice C)    │◀──────────────────▶│    (Freq / Mode / PTT)      │
     └──────────────────────────────┘                    └──────────────────────────────┘
    
     ┌──────────────────────────────┐                    ┌──────────────────────────────┐
     │           WSJT-X D           │                    │        Flex Slice D         │
     │    (Instance for Slice D)    │◀──────────────────▶│    (Freq / Mode / PTT)      │
     └──────────────────────────────┘                    └──────────────────────────────┘
     
     
     
     
     


                      ┌───────────────────────────┐
                      │         Logger            │
                      │        (Log4OM)           │
                      │  • HRD rig via MCP        │
                      │  • Imports ADIF from MCP  │
                      └───────────────────────────┘

---

# 3. Channels and Slices

MCP operates on **channels**. A channel is an abstraction over a **Flex slice** or, in the future, another radio’s VFO.

For v3:

- Support **exactly 4 channels:** indices 0–3, mapped to Flex slices A–D.
- Each channel may run one WSJT‑X instance.

### 3.1 Channel State Object

Each channel has a state object (language-agnostic struct):

```jsonc
ChannelState {
  id: string,            // "A", "B", "C", "D"
  index: number,         // 0–3
  freq_hz: number,       // current dial frequency in Hz
  mode: "FT8" | "FT4" | "DIGU" | "USB" | "LSB" | "CW" | "FM" | string,
  is_tx: boolean,        // true if this is TX slice
  dax_rx: number | null, // DAX RX channel number
  dax_tx: number | null, // DAX TX channel (global)
  wsjtx_udp_port: number,// UDP port WSJT‑X instance uses
  hrd_port: number,      // HRD TCP port for this channel
  status: "idle" | "decoding" | "calling" | "in_qso" | "error",
  last_decode_time: string | null // ISO8601
}
```

The MCP maintains:

```jsonc
McpState {
  channels: ChannelState[],
  flex_connected: boolean,
  wsjtx_instances: WsjtxInstanceState[],
  logbook: LogbookIndex,
  config: McpConfig
}
```

---

# 4. Rig Control Protocol (HRD TCP)

WSJT‑X and the logger both control the radio **only via MCP’s HRD TCP server(s)**.

## 4.1 HRD Connections

- **Per-channel HRD servers**: one port per WSJT‑X instance.
- **One main HRD server**: for the external logger (Log4OM).

All HRD servers share the same **command grammar** and **case-insensitive** parsing.

## 4.2 Command Grammar

Commands are ASCII lines, terminated by **CRLF** (`\r\n`). MCP must accept both `\n` and `\r\n` for robustness.

All commands and keywords are **case-insensitive**; arguments (numbers) are decimal.

### Supported commands (minimal set)

From clients (WSJT‑X, Logger):

- `get frequency`  
- `set frequency <Hz>`  
- `get mode`  
- `set mode <MODE>`  
- `get ptt`  
- `set ptt on`  
- `set ptt off`  

### Responses

- For `get` commands: plain value + CRLF, then `RPRT 0` + CRLF. Example:

  ```text
  7074000
  RPRT 0
  ```

- For successful `set` commands: `RPRT 0` + CRLF.

- For unsupported/invalid commands: `RPRT -1` + CRLF.

Error codes for internal failures (Flex not connected, etc.): `RPRT -9` (generic backend error).

## 4.3 Unsolicited Updates

To keep WSJT‑X and the logger synchronized with Flex when frequencies/modes change via other means, MCP MAY send **unsolicited updates**:

```text
frequency <Hz>\r\n
mode <MODE>\r\n
ptt <on|off>\r\n
```

These are sent when:

- Channel dial frequency changes due to AI actions.
- Flex slice changes frequency or mode outside MCP (if monitored).
- PTT state changes.

The unsolicited updates do **not** modify SmartSDR UI directly; they just reflect Flex slice state.

---

# 5. Flex Backend (SmartSDR v4.x)

The Flex backend is the only component that talks directly to the Flex radio.

## 5.1 Assumptions

- Flex SmartSDR **v4.x** compatible protocol.  
- MCP uses the official TCP/WebSocket API.  
- MCP may auto-discover the radio via UDP, or a fixed IP can be configured.

## 5.2 Flex Backend Interface

Internally, MCP code must expose an interface similar to:

```ts
interface FlexBackend {
  connect(host: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  getSlices(): Promise<FlexSliceState[]>;

  ensureFourSlicesOnBands(bands: string[]): Promise<void>;
  setSliceFrequency(index: number, freq_hz: number): Promise<void>;
  setSliceMode(index: number, mode: string): Promise<void>;
  setTxSlice(index: number): Promise<void>;

  onSliceUpdated(callback: (sliceIndex: number, state: FlexSliceState) => void): void;
  onConnectionLost(callback: () => void): void;
}
```

- `ensureFourSlicesOnBands` creates/configures up to 4 slices (A–D) on **different bands**, as configured or by default (e.g., 80/40/20/10m FT8).
- MCP must only control **slices**; panadapters and other UI aspects are considered out of scope for v3, except what’s strictly necessary to operate slices.

## 5.3 Connection & Recovery

- On startup, MCP attempts to connect to the Flex radio (IP from config or discovery).  
- On disconnection, MCP retries with exponential backoff (e.g., 1s, 2s, 4s … up to 60s, then stays at 60s).  
- During Flex disconnect:
  - HRD commands return `RPRT -9`.  
  - Status API reflects `flex_connected = false`.

---

# 6. WSJT‑X Instance Management & INI Generation

MCP must manage **up to 4 WSJT‑X processes** – one per active channel.

## 6.1 Lifecycle

- On MCP startup:
  1. Connect to Flex.
  2. Ensure 4 slices on configured/default bands.
  3. For each channel:
     - Generate/patch WSJT‑X INI.
     - Launch WSJT‑X with `--rig-name=<channel-id>`.
- When MCP settings change (via UI):
  - MCP writes updated config to JSON.
  - MCP **gracefully stops all WSJT‑X instances**, regenerates INIs, and relaunches them.

- If a WSJT‑X instance crashes:
  - MCP restarts it up to N times (configurable, e.g. N=5) with a small delay.

## 6.2 INI Management (Summary)

MCP uses the INI logic already defined in the integrated configuration spec:

- Maintains a `base_template.ini`.  
- For each rig-name (e.g., `SliceA`), MCP:
  - Ensures the target folder exists.  
  - Copies `base_template.ini` → `WSJT-X - SliceA.ini` if missing.  
  - Reads existing INI and overwrites **only** critical sections:

    - `[General]`: callsign, grid.  
    - `[Radio]`: Rig = HRD, NetworkServer = MCP HRD port, PTT = CAT.  
    - `[Audio]`: DAX input/output names.  
    - `[Configuration]`: UDP server & port.

- WSJT‑X is allowed to change **UI-related settings** (colors, window layout), which MCP preserves on next launch using a **read-modify-write** approach.

The MCP is the **source of truth** for radio/audio/network settings.

## 6.3 Audio Device Resolution

On Windows, MCP must:

- Enumerate audio devices.  
- For each channel, find the device whose name best matches `DAX Audio RX {n}` (or a configurable pattern).  
- Use exact device name strings in `[Audio]` section.  
- If no matching DAX device is found, log a warning and still launch WSJT‑X with a placeholder value.

---

# 7. Decode Aggregation Module

Each WSJT‑X instance broadcasts UDP packets on a dedicated port:

- Channel 0 / Slice A → 2237  
- Channel 1 / Slice B → 2238  
- Channel 2 / Slice C → 2239  
- Channel 3 / Slice D → 2240  

Ports may be auto-assigned with this pattern and stored in config.

## 7.1 Supported WSJT‑X Messages

For v3, MCP must support at least these WSJT‑X UDP message types:

- **Decode** (new decoded message)  
- **Status** (current dial, mode, etc.)  
- **QSO Logged / LoggedContact** (QSO completed)

Messages are parsed from the WSJT‑X standard binary UDP format.

## 7.2 Decode Representation

For each decode, MCP produces an internal record:

```jsonc
DecodeRecord {
  timestamp: string,     // ISO8601 UTC
  channel_index: number, // 0–3
  slice_id: string,      // "A".."D"
  dial_hz: number,       // from channel state
  audio_offset_hz: number,
  rf_hz: number,         // dial_hz + audio_offset_hz
  snr_db: number,
  dt_sec: number,
  call: string | null,
  grid: string | null,
  is_cq: boolean,
  is_my_call: boolean,
  raw_text: string
}
```

## 7.3 Storage & Lifetime

- MCP maintains an **in-memory ring buffer per channel**, storing decodes from a **configurable time window** (e.g., last 15 minutes).  
- The actual implementation may use:
  - Time-based eviction (drop records older than `config.decode_history_minutes`).

No persistent storage for decodes is required in v3.

## 7.4 Duplicate Detection

MCP must be able to answer: *“Have we already worked CALL on BAND and MODE?”*

- MCP maintains a **LogbookIndex** with entries:

```jsonc
WorkedIndexEntry {
  call: string,
  band: string,  // "20m"
  mode: string,  // "FT8", "FT4"
  last_qso_time: string // ISO8601
}
```

- Before proposing or initiating a call, MCP (or the AI via tools) can query this index.  
- MCP updates this index on each successfully logged QSO (see QSO Relay).

---

# 8. QSO Relay & Internal Logbook

MCP becomes the **single QSO hub** for WSJT‑X and external loggers.

## 8.1 QSO Ingestion

When WSJT‑X logs a QSO (via UDP QSO Logged / LoggedContact), MCP:

1. Identifies the channel (via source UDP port).  
2. Reads the current channel state (freq, mode, band).  
3. Combines WSJT‑X QSO info (call, grid, report, time) with Flex state.  
4. Produces a **QsoRecord**:

```jsonc
QsoRecord {
  timestamp_start: string, // from WSJT-X or approximated
  timestamp_end: string,
  call: string,
  grid: string | null,
  band: string,
  freq_hz: number,
  mode: string,          // FT8/FT4 primarily
  rst_sent: string | null,
  rst_recv: string | null,
  tx_power_w: number | null,
  slice_id: string,
  channel_index: number,
  wsjtx_instance: string,
  notes: string | null
}
```

5. Appends this QSO to a **local ADIF log file** (single unified file for all slices, e.g. `mcp_logbook.adi`).  
6. Updates the **WorkedIndex** for duplicate detection.

## 8.2 External Logbook Forwarding

To feed external loggers (e.g. Log4OM), MCP supports:

1. **ADIF File Feed (primary)**  
   - External logger is configured to periodically import from `mcp_logbook.adi`.

2. **JSON QSO API (optional)**  
   - REST: `GET /api/qsos` for tailing recent QSOs or `POST /api/qsos` for future manual additions.

3. **Optional WSJT‑X-compatible UDP relay (future)**  
   - Out of scope for v3 unless explicitly enabled; design must leave room for its addition.

MCP aims to be the **primary source of QSO data**; direct WSJT‑X → logger integration is not required in v3.

---

# 9. Logging Program Integration (Rig Control)

External logging software connects to MCP as if it were an HRD server.

## 9.1 Connection

- **Logger Rig:** “Ham Radio Deluxe”  
- **Server:** `MCP_HOST:HRD_MAIN_PORT` (configurable, e.g. 7800)  
- MCP must allow **multiple logger clients** on this main HRD port, all seeing the same state.

## 9.2 Behavior

- Logger can read current frequency/mode and possibly set them.  
- MCP maps logger HRD commands to the **current TX channel** by default.  
- MCP must ensure that logger operations do not conflict with AI/WSJT‑X operations; if conflict is detected, MCP may:
  - Ignore certain logger `set` commands (config option), or  
  - Accept but expose this via the AI tooling.

v3: simplest behavior: allow logger `set frequency` / `set mode`, treat them like operator actions.

---

# 10. Internal Modules & Process Model

MCP runs as a **single process** with asynchronous I/O and worker components. Only one binary/installation is required.

Recommended module structure (TypeScript implementation):

```text
src/
├── index.ts                    # Entry point, startup orchestration
├── SettingsManager.ts          # Configuration loading/saving, change detection

├── wsjtx/                      # WSJT-X management
│   ├── WsjtxManager.ts         # Top-level orchestrator
│   ├── ProcessManager.ts       # Process spawning/lifecycle
│   ├── FlexRadioManager.ts     # FlexRadio slice-to-instance mapping
│   ├── WindowManager.ts        # WSJT-X window positioning
│   ├── WsjtxConfig.ts          # INI file generation
│   ├── UdpListener.ts          # WSJT-X UDP message parsing
│   ├── UdpSender.ts            # WSJT-X UDP message encoding
│   ├── QsoStateMachine.ts      # Autonomous QSO state transitions
│   └── types.ts                # WSJT-X type definitions

├── state/                      # MCP state management
│   ├── StateManager.ts         # Aggregate MCP state
│   ├── ChannelUdpManager.ts    # Per-channel UDP communication
│   ├── types.ts                # State type definitions
│   └── index.ts

├── logbook/                    # Logbook operations
│   ├── LogbookManager.ts       # ADIF read/write, WorkedIndex, HRD server for loggers
│   └── index.ts

├── dashboard/                  # Web dashboard state
│   ├── DashboardManager.ts     # Station tracking, status computation
│   └── index.ts

├── cat/                        # CAT control
│   └── HrdCatServer.ts         # HRD protocol server for WSJT-X and loggers

├── flex/                       # FlexRadio backend
│   ├── FlexClient.ts           # High-level Flex wrapper
│   ├── Vita49Client.ts         # VITA 49 protocol to SmartSDR
│   └── FlexDiscovery.ts        # Broadcast discovery

├── mcp/                        # MCP protocol
│   └── McpServer.ts            # MCP stdio transport, tools, resources

├── web/                        # Web interface
│   └── server.ts               # Express + WebSocket server

└── frontend/                   # React web dashboard (separate build)
```

### Manager Summary

| Manager | Purpose |
|---------|---------|
| **WsjtxManager** | Top-level WSJT-X orchestration |
| **ProcessManager** | WSJT-X process spawning/lifecycle |
| **FlexRadioManager** | FlexRadio slice-to-instance mapping |
| **StateManager** | MCP state aggregation |
| **ChannelUdpManager** | Per-channel UDP communication |
| **LogbookManager** | ADIF, WorkedIndex, HRD server for external loggers |
| **DashboardManager** | Station tracking for web UI |
| **WindowManager** | WSJT-X window positioning |
| **SettingsManager** | Configuration file management |

- All network components (HRD servers, UDP listeners, REST) are non-blocking.  
- Each WSJT‑X instance is supervised by a **WSJT-X Worker** that handles spawn, restart, and shutdown.

---

# 11. LLM Tool / REST API

The AI interacts with MCP via a **tool-like JSON API** (could be transported via REST or other RPC).

## 11.1 `rig_get_state()`

Returns full MCP state summary.

**Request:**

```json
{ "action": "rig_get_state" }
```

**Response (example):**

```jsonc
{
  "channels": [
    {
      "id": "A",
      "index": 0,
      "freq_hz": 14074000,
      "band": "20m",
      "mode": "FT8",
      "is_tx": true,
      "status": "decoding",
      "last_decode_time": "2025-11-26T18:42:05Z"
    },
    ...
  ],
  "flex_connected": true
}
```

## 11.2 `rig_tune_channel(index, freq_hz)`

Moves a specific channel to a new frequency.

**Request:**

```json
{
  "action": "rig_tune_channel",
  "channel_index": 1,
  "freq_hz": 7074000
}
```

**Behavior:**
- MCP calls `FlexBackend.setSliceFrequency(1, freq_hz)`.  
- HRD server for that channel reflects the new frequency.  
- WSJT‑X sees frequency change via its HRD connection.

## 11.3 `rig_set_tx_channel(index)`

Sets which channel is TX slice.

**Request:**

```json
{
  "action": "rig_set_tx_channel",
  "channel_index": 2
}
```

MCP invokes `FlexBackend.setTxSlice(2)` and updates internal state.

## 11.4 `rig_emergency_stop()`

Immediately stops all transmissions.

**Request:**

```json
{ "action": "rig_emergency_stop" }
```

Behavior:

- Sends `set ptt off` to all HRD channels.  
- Calls backend to disable any active TX slice if necessary.  

## 11.5 `wsjtx_get_decodes(channel_index, since_ms)`

Returns recent decodes for a channel.

**Request:**

```json
{
  "action": "wsjtx_get_decodes",
  "channel_index": 0,
  "since_ms": 30000
}
```

**Response:**

```jsonc
{
  "decodes": [
    {
      "timestamp": "2025-11-26T18:42:05Z",
      "rf_hz": 14074750,
      "dial_hz": 14074000,
      "snr_db": -12,
      "dt_sec": 0.4,
      "call": "DL1ABC",
      "grid": "JO62",
      "is_cq": true,
      "is_my_call": false
    }
  ]
}
```

## 11.6 `log_get_worked(call, band, mode)`

Checks if a station is already in the logbook on a specific band/mode.

**Request:**

```json
{
  "action": "log_get_worked",
  "call": "DL1ABC",
  "band": "20m",
  "mode": "FT8"
}
```

**Response:**

```jsonc
{
  "worked": true,
  "last_qso_time": "2025-11-20T19:05:00Z"
}
```

## 11.7 `log_get_recent_qsos(limit)`

Returns recent QSOs from MCP logbook.

## 11.8 Future: `ai_call_best_station()`

Not defined in strict detail here, but the FSD supports it: AI can use `wsjtx_get_decodes` + `log_get_worked` + `rig_tune_channel` + PTT control to implement autonomous calling logic.

---

# 12. MCP Configuration (JSON)

MCP stores its configuration in a single JSON file, **owned and managed by MCP** (no manual editing required, though it should remain human-readable).

Example: `mcp-config.json`

```jsonc
{
  "flex": {
    "host": "192.168.1.50",
    "auto_discover": true,
    "default_bands": ["80m", "40m", "20m", "10m"]
  },
  "network": {
    "bind_address": "0.0.0.0",
    "hrd_main_port": 7800,
    "hrd_channel_base_port": 7801,
    "wsjtx_udp_base_port": 2237,
    "rest_port": 8080
  },
  "station": {
    "callsign": "HB9BL",
    "grid": "JN36",
    "audio_api": "MME"
  },
  "decode": {
    "history_minutes": 15
  },
  "logbook": {
    "adif_file": "mcp_logbook.adi"
  }
}
```

- MCP exposes a **settings screen** in its frontend where the user edits these values.
- MCP validates settings (e.g., with JSON Schema) before saving.
- MCP is the only component that writes to this JSON file.

## 12.1 Smart Config Reload

When the user saves configuration changes via the UI, MCP determines the appropriate action based on what changed:

### Change Levels

1. **Live Reload** (`live`) - Applied immediately, no restart needed:
   - Dashboard settings (colors, thresholds, station lifetime)
   - Station callsign/grid
   - ADIF log path

2. **WSJT-X Restart** (`wsjtx_restart`) - Instances are gracefully restarted:
   - WSJT-X executable path (`wsjtx.path`)
   - HRD CAT base port (`flex.catBasePort`)
   - Default bands (`flex.defaultBands`)
   - Standard rig name (`standard.rigName`)

3. **App Restart** (`app_restart`) - User must manually restart MCP:
   - Operation mode (`mode`: FLEX/STANDARD)
   - Web server port (`web.port`)
   - FlexRadio host (`flex.host`)

### API Response

The config save endpoint returns change level information:

```jsonc
{
  "success": true,
  "config": { /* updated config */ },
  "message": "Config applied immediately.",
  "changeLevel": "live",      // "live" | "wsjtx_restart" | "app_restart"
  "changedFields": ["dashboard.colors.worked"],
  "action": "none"            // "none" | "wsjtx_restart" | "app_restart"
}
```

### Restart Behavior

For `wsjtx_restart` level changes:
- MCP saves current state (frequencies, slice mappings)
- Gracefully stops all WSJT-X processes
- Regenerates INI files with new settings
- Relaunches instances in the same order
- HRD CAT servers remain running (no reconnection needed)

This minimizes disruption during configuration changes.

---

# 13. Runtime & Error Model

## 13.1 Process Model

- Single process binary.  
- Inside: asynchronous event loops for HRD servers, UDP listeners, Flex backend, and REST API.  
- WSJT‑X instances are external processes supervised by MCP.

## 13.2 Error Handling Policies

- **WSJT‑X crash:** restart up to N times (configurable), then mark channel as `status="error"` and surface in API/UI.  
- **Flex disconnect:**  
  - Attempt reconnect with backoff.  
  - HRD commands return `RPRT -9`.  
  - API reports `flex_connected=false`.  
- **UDP parse error:** drop packet, increment error counter, log debug message.  
- **INI corruption:** if WSJT‑X fails repeatedly for one instance, MCP can regenerate that instance’s INI from `base_template.ini` and log a warning.

---

# 14. Security & Networking

- MCP ports (HRD, REST) bind to `network.bind_address`, which is **configurable**.  
  - For a typical shack setup, user may choose `127.0.0.1` (local only) or `0.0.0.0` (LAN).  
- No authentication or TLS is required in v3; environment is assumed trusted LAN.  
- Design should keep room for future auth/TLS, but no implementation is needed now.

---

# 15. Non-Goals for v3

- No CW Skimmer or RBN integration.  
- No Telnet cluster server.  
- No Prometheus/metrics.  
- No panadapter/waterfall control beyond what Flex requires for a slice.  
- No non-Flex radio backend implementation (Hamlib backend can be a stub).

---

# 16. Implementation Deliverables (For AI)

The AI implementation should produce at least:

1. **Core Daemon**
   - Implements this FSD on Windows (first target).  
   - Provides executable `mcp.exe` (or equivalent).

2. **Flex Backend Stub/Implementation**
   - Real SmartSDR v4.x implementation OR a clearly separated stub plus an interface that can later be bound to the real API.

3. **HRD TCP Servers**
   - 1 main HRD port for logger.  
   - 4 per-channel HRD ports for WSJT‑X instances.

4. **WSJT‑X Manager**
   - INI generator/patcher.  
   - Process launcher and supervisor.

5. **UDP Decode Listener**
   - Parsing WSJT‑X UDP messages.  
   - Maintaining per-channel decode history.

6. **QSO Logbook**
   - ADIF writer.  
   - WorkedIndex for (call, band, mode) checks.

7. **Config Manager**
   - JSON read/write.  
   - Integration with a minimal settings UI (or at least REST endpoints).

8. **LLM Tool / REST Layer**
   - JSON-based commands for rig state, decodes, logbook queries, and basic rig operations.

All modules MUST adhere to the data structures and flows defined here so that future AI agents can safely reason about, extend, and regenerate MCP code without ambiguity.

---

# End of MCP-fsd.md (Version 3)
