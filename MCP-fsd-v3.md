# MCP for WSJT-X – Functional Specification Document

## Part I – MCP Interface Specification

**Multi-Channel Digital Mode Control Framework**
**Version: v7 (Minimal AI-Friendly Interface)**

---

## Document Purpose

This document specifies the ** MCP agent** for WSJT-X control, designed for autonomous operation.

**Design Philosophy:**
- Hide internal complexity from AI clients
- Server-side intelligence for routing and decision-making
- Minimal, declarative interface (4 tools, 1 resource)
- No exposure of slices, channels, or instance IDs

---

## Part I – Public MCP Interface 

#### 1. Interface Overview

The MCP server provides a minimal, AI-friendly interface:

- **1 Resource** for querying decodes
- **4 Tools** for control operations (2 core + 1 state + 1 safety)
- **Events** (planned: `resources/updated` for decode snapshots)
- **Stdio Transport** for MCP client communication

**No Exposed Internals:**
- ✅ No slice indices
- ✅ No channel IDs
- ✅ No instance names
- ✅ Server handles all routing automatically

---

#### 2. Resource

##### 2.1 `wsjt-x://decodes`

Unified decode snapshot from all channels/slices.

**MIME Type:** `application/json`

**Returns:** `DecodesSnapshot` (see §4.2)

**Purpose:**
- Recovery and late-joiners (when client restarts)
- Primary data source for AI decision-making
- Contains enriched decode data with server-side CQ targeting

**Update Mechanism:**
- Currently: Poll this resource periodically
- Future: `resources/updated` event (see §5)

---

#### 3. Tools

##### 3.1 Core Tools (2)

##### `call_cq`

Start or continue calling CQ. MCP automatically selects the best slice/channel.

**Input:**
```ts
{
  band?: string;              // e.g., "20m" (optional)
  freq_hz?: number;           // Optional dial frequency in Hz
  mode?: "FT8" | "FT4";       // Default: FT8
}
```

**Output:**
```ts
{
  status: string;             // Human-readable status
  band: string;               // Actual band used
  freq_hz: number;            // Actual dial frequency
  mode: string;               // Actual mode
}
```

**Server-Side Intelligence:**
- Automatically selects best available slice/channel
- Tunes to requested band/frequency if specified
- Sets TX designation
- Enables autonomous CQ calling (WSJT-X AutoSeq)

---

##### `answer_decoded_station`

Answer a decoded station by decode_id. MCP handles all routing automatically.

**Input:**
```ts
{
  decode_id: string;          // DecodeRecord.id from latest snapshot
  force_mode?: "FT8" | "FT4"; // Optional mode override
}
```

**Output:**
```ts
{
  status: string;             // e.g., "Reply sent, QSO in progress"
  band: string;               // Band used
  freq_hz: number;            // Dial frequency used
  mode: string;               // Mode used
  target_call: string;        // Station being answered
}
```

**Server-Side Intelligence:**
- Finds decode by ID from unified snapshot
- Routes to correct channel automatically
- **Duplicate detection:** Checks if station already worked
- Sets TX designation
- Sends WSJT-X Reply command to answer

---

##### 3.2 State Tool (1)

##### `rig_get_state`

Read-only view of rig state (channels, TX designation, connection status).

**Input:** None

**Output:**
```ts
{
  channels: Array<{
    id: string;               // "A", "B", "C", "D"
    index: number;            // 0-3
    freq_hz: number;
    band: string;
    mode: string;
    is_tx: boolean;
    status: ChannelStatus;
    connected: boolean;
    last_decode_time: string | null;
  }>,
  tx_channel: string | null,  // "A", "B", "C", "D" or null
  flex_connected: boolean
}
```

**Purpose:**
- Diagnostic information for AI agents
- Understanding current rig configuration
- Not required for normal operation (call_cq/answer handle routing)

---

##### 3.3 Safety Tool (1)

##### `rig_emergency_stop`

Emergency TX stop - immediately disable transmit on all slices.

**Input:** None

**Output:**
```ts
{
  status: string;             // "EMERGENCY STOP: TX disabled on all slices"
}
```

**Purpose:**
- Safety kill switch for AI control
- Immediately stops all transmission
- Use when AI needs to abort operation

---

#### 4. Type Definitions

##### 4.1 ChannelStatus

```ts
type ChannelStatus = 'idle' | 'decoding' | 'calling' | 'in_qso' | 'error' | 'offline';
```

##### 4.2 DecodesSnapshot

Snapshot of all current decodes from all channels.

```ts
interface DecodesSnapshot {
  snapshot_id: string;        // Unique ID (UUID)
  generated_at: string;       // ISO8601 UTC timestamp
  decodes: DecodeRecord[];    // All decodes from all channels
}
```

##### 4.3 DecodeRecord

A single decoded FT8/FT4 message enriched by MCP.

```ts
interface DecodeRecord {
  id: string;                 // Unique within snapshot

  timestamp: string;          // ISO8601 UTC

  band: string;               // "20m", "40m", etc.
  mode: string;               // "FT8" | "FT4"

  dial_hz: number;            // WSJT-X dial frequency
  audio_offset_hz: number;    // DF in Hz
  rf_hz: number;              // dial + audio_offset

  snr_db: number;             // SNR in dB
  dt_sec: number;             // Timing offset in seconds

  call: string;               // Decoded primary callsign
  grid: string | null;        // Maidenhead locator or null

  is_cq: boolean;             // True if CQ-type message
  is_my_call: boolean;        // True if addressed to our callsign

  // Server-side CQ targeting decision (AUTHORITATIVE)
  is_directed_cq_to_me: boolean;

  // Raw CQ token (informational only)
  cq_target_token: string | null;  // "DX", "NA", "EU", "JA", etc.

  raw_text: string;           // Original WSJT-X decode text

  // Optional WSJT-X flags
  is_new?: boolean;
  low_confidence?: boolean;
  off_air?: boolean;
}
```

**Important:**
- `is_directed_cq_to_me` is computed by server using station profile (see §6)
- Clients MUST treat this field as authoritative
- Clients MUST NOT reimplement CQ targeting logic

##### 4.4 Internal vs External Decode Records

**Implementation Detail:**

The server maintains two decode record types:

1. **InternalDecodeRecord** - Used internally, includes routing fields:
   - `channel_index: number` (0-3)
   - `slice_id: string` ("A", "B", "C", "D")
   - All fields from DecodeRecord

2. **DecodeRecord** - Public API format (exposed via MCP)
   - No internal routing fields
   - Includes `id` field (unique within snapshot)

When building `DecodesSnapshot`, the server:
1. Collects InternalDecodeRecord from all channels
2. Strips `channel_index` and `slice_id` (hiding internals)
3. Adds unique `id` field
4. Wraps in snapshot with `snapshot_id` and `generated_at`

This ensures clients never see slice/channel routing details, maintaining the abstraction barrier specified in §7.

---

#### 5. Events (Planned)

##### 5.1 `resources/updated`

Will be emitted after each FT8/FT4 decode cycle:

```jsonc
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": {
    "uri": "wsjt-x://decodes",
    "snapshot": { /* DecodesSnapshot */ }
  }
}
```

**Guarantee:**
The `snapshot` in the event MUST be identical to the `DecodesSnapshot` returned by the `wsjt-x://decodes` resource.

**Status:** Documented but not yet implemented (MCP SDK limitation). Clients should poll `wsjt-x://decodes` for now.

---

#### 6. Server-Side CQ Targeting

MCP computes `is_directed_cq_to_me` using station configuration.

##### 6.1 Station Configuration

The server uses a `StationProfile` for CQ targeting decisions:

```ts
interface StationProfile {
  my_call: string;           // Station callsign
  my_continent: string;      // "EU", "NA", "SA", "AF", "AS", "OC", "AN"
  my_dxcc: string;           // DXCC prefix (e.g., "HB9", "W", "K")
  my_prefixes: string[];     // All valid prefixes for this station
}
```

Configuration in `config.json`:
```jsonc
{
  "station": {
    "callsign": "HB9BL",
    "grid": "JN36",
    "continent": "EU",        // EU, NA, SA, AF, AS, OC, AN
    "dxcc": "HB9",            // e.g., "HB9", "W", "K"
    "prefixes": ["HB9","HB3"] // All known prefixes
  }
}
```

##### 6.2 Targeting Rules

- **`CQ`** (no token) → `is_directed_cq_to_me = true` (everyone eligible)
- **`CQ NA`** → `continent === "NA"`
- **`CQ EU`** → `continent === "EU"`
- **`CQ DX`** → Station policy (typically "not same DXCC entity")
- **`CQ JA`** → DXCC/prefix match for Japan

##### 6.3 Client Behavior (NORMATIVE)

- Clients MUST treat `is_directed_cq_to_me` as authoritative
- Clients MUST NOT reimplement CQ targeting logic
- Clients MAY use `cq_target_token` for informational purposes only
- Clients SHOULD only answer CQs where `is_cq === true` AND `is_directed_cq_to_me === true`

---

### 7. Behavioral Guarantees (Normative)

1. **No Internal Exposure:** MCP MUST NOT expose slice IDs, channel indices, or WSJT-X instance names to clients
2. **Automatic Routing:** `call_cq` and `answer_decoded_station` MUST handle slice/channel selection automatically
3. **Duplicate Detection:** `answer_decoded_station` MUST check if station already worked (logs warning but proceeds)
4. **Snapshot Consistency:** Event snapshots and resource snapshots MUST match exactly
5. **CQ Targeting:** MCP is authoritative for CQ targeting decisions

---

## Part II – Internal Server Architecture

### 8. Core Components

#### 8.1 Module Structure

```
src/
├── index.ts                    # Entry point, startup orchestration
├── SettingsManager.ts          # Configuration loading/saving, Zod validation
│
├── wsjtx/                      # WSJT-X management
│   ├── WsjtxManager.ts         # Top-level orchestrator
│   ├── ProcessManager.ts       # Process spawning/lifecycle
│   ├── FlexRadioManager.ts     # Flex slice-to-instance mapping
│   ├── WindowManager.ts        # WSJT-X window positioning
│   ├── WsjtxConfig.ts          # INI file generation
│   ├── UdpListener.ts          # WSJT-X UDP message parsing
│   ├── UdpSender.ts            # WSJT-X UDP message encoding
│   ├── QsoStateMachine.ts      # Autonomous QSO state machine
│   └── types.ts                # WSJT-X type definitions
│
├── state/
│   ├── StateManager.ts         # Aggregate MCP state
│   ├── ChannelUdpManager.ts    # Per-channel UDP communication
│   ├── types.ts                # Type definitions (DecodeRecord, etc.)
│   └── index.ts
│
├── logbook/
│   ├── LogbookManager.ts       # ADIF read/write, WorkedIndex
│   └── index.ts
│
├── cat/
│   └── HrdCatServer.ts         # HRD protocol server for WSJT-X + loggers
│
├── flex/
│   ├── FlexClient.ts           # High-level Flex wrapper (SmartSDR v4.x)
│   ├── Vita49Client.ts         # VITA-49 protocol implementation
│   └── FlexDiscovery.ts        # UDP discovery
│
├── mcp/
│   └── McpServer.ts            # MCP stdio transport, tools, resources
│
└── web/
    └── server.ts               # Web dashboard (HTTP/WebSocket)
```

---

### 9. Operation Modes

Two operation modes configured via `config.json`:

#### 9.1 STANDARD Mode (Default)
- Uses `ProcessManager` for manual WSJT-X instance management
- Single rig, single instance
- Basic CAT control

#### 9.2 FLEX Mode
- Uses `FlexRadioManager` for dynamic multi-slice management
- Up to 4 WSJT-X instances (one per slice A-D)
- Full FlexRadio integration via SmartSDR API
- HRD CAT servers per instance (ports 7809-7812)
- Dynamic slice tuning and TX designation

---

### 10. Configuration

Configuration stored in `config.json` (project root).

#### 10.1 Configuration Schema

```ts
{
  mode: "FLEX" | "STANDARD",              // Default: STANDARD

  wsjtx: {
    path: string                          // WSJT-X executable path
  },

  station: {
    callsign: string,
    grid: string,
    continent: string,                    // EU, NA, SA, AF, AS, OC, AN
    dxcc: string,                         // e.g., "HB9", "W"
    prefixes: string[]                    // All known prefixes
  },

  standard: {
    rigName: string                       // Default: "IC-7300"
  },

  flex: {
    host: string,                         // Default: "127.0.0.1"
    catBasePort: number,                  // Default: 60000
    defaultBands?: number[]               // Optional default bands (Hz)
  },

  dashboard: {
    stationLifetimeSeconds: number,       // Default: 120
    snrWeakThreshold: number,             // Default: -15
    snrStrongThreshold: number,           // Default: 0
    adifLogPath: string,
    colors?: { /* ... */ }
  },

  logbook: {
    path?: string,                        // Default: %APPDATA%/wsjt-x-mcp/mcp_logbook.adi
    enableHrdServer: boolean,             // Default: false
    hrdPort: number                       // Default: 7800
  },

  mcp: {
    name: string,                         // Default: "wsjt-x-mcp"
    version: string                       // Default: "1.0.0"
  },

  web: {
    port: number                          // Default: 3000
  }
}
```

Configuration is validated using Zod schemas in `src/SettingsManager.ts`.

---

### 11. WSJT-X UDP Protocol

MCP communicates with WSJT-X via UDP using Qt QDataStream binary format:

- **Magic number**: `0xadbccbda`
- **Schema version**: 2
- **Base port**: 2237 (increments for multiple instances: 2237, 2238, 2239, 2240)
- **Message types**: Heartbeat (0), Status (1), Decode (2), Reply (4), QsoLogged (5), Close (6), HaltTx (8), FreeText (9), Configure (15)

Implementation:
- Parsing: `src/state/ChannelUdpManager.ts`
- Encoding: `src/wsjtx/UdpSender.ts`
- Types: `src/wsjtx/types.ts`

#### 11.1 Message Format

All messages follow this structure:
```
[Magic:4][Schema:4][Type:4][ID:QString][Payload...]
```

**QString Encoding:**
- Length prefix (quint32): 0xFFFFFFFF = null, 0 = empty, N = byte count
- String data: **Latin-1/ASCII** (NOT UTF-16BE despite Qt documentation)
- WSJT-X implementation uses simple 8-bit encoding for QString in UDP messages

#### 11.2 Key Message Types

**Reply Message (Type 4)** - Used by `answer_decoded_station`:
```
[Time:quint32][SNR:qint32][DeltaTime:float64][DeltaFreq:quint32]
[Mode:QString][Message:QString][LowConf:bool][Modifiers:quint8]
```
- `Modifiers`: 0x02 = Shift key (enables TX)
- Tells WSJT-X to reply to a specific decode

**FreeText Message (Type 9)** - Used by `call_cq`:
```
[Text:QString][Send:bool]
```
- Sets free text message and optionally triggers TX

**Configure Message (Type 15)** - Changes WSJT-X settings:
```
[Mode:QString][FreqTol:quint32][Submode:QString][FastMode:bool]
[TRPeriod:quint32][RxDF:quint32][DxCall:QString][DxGrid:QString]
[GenMsgs:bool]
```
- Empty QString or 0xFFFFFFFF = no change
- Used to set mode, clear DX call/grid, enable message generation

---

### 12. HRD CAT Protocol

MCP runs HRD-compatible TCP servers for rig control:

- **1 main HRD port** (7800) for external loggers (e.g., Log4OM)
- **4 per-channel HRD ports** (7809-7812) for WSJT-X instances

#### 12.1 Binary Message Format (HRD v5/v6)

WSJT-X uses the HRD binary protocol (not the ASCII protocol). Each message has:

**Header (16 bytes):**
```
[Size:int32][Magic1:0x1234ABCD][Magic2:0xABCD1234][Checksum:int32]
```

**Payload:**
- UTF-16LE encoded strings
- Null-terminated (0x0000)
- Commands are text strings in this encoding

#### 12.2 Key Commands

**From WSJT-X:**
- `get frequency` / `get frequency-hz` - Query dial frequency
- `set frequency-hz <Hz>` - Set dial frequency
- `get mode` - Query radio mode
- `set dropdown Mode <MODE> <index>` - Set radio mode
- `get button-select {TX}` / `{PTT}` - Query PTT state
- `set button-select {TX} 1` - Enable PTT
- `set button-select {TX} 0` - Disable PTT
- `get radio` / `get radios` - Radio identification
- `get context` / `get contexts` - VFO/slice info

**Radio Selector Prefix:**
Commands may include `[N]` prefix (e.g., `[1] set button-select TX 1`), which must be stripped before parsing.

Implementation: `src/cat/HrdCatServer.ts`

---

### 13. WSJT-X Instance Management

#### 13.1 INI File Generation

Uses **template-based configuration**:

1. **Template file**: `templates/wsjtx-template.ini` (required)
2. **Per-instance INI**: `%LOCALAPPDATA%\WSJT-X - <RigName>\WSJT-X - <RigName>.ini`

**Slice-specific parameters (unique per instance):**
- CAT control: `CATNetworkPort` (e.g., `127.0.0.1:7809`)
- UDP port: `UDPServerPort` (e.g., `2237`, `2238`, etc.)
- Audio: `SoundInName` (e.g., `DAX Audio RX 1`)

**Common parameters (same for all):**
- Station info: `MyCall`, `MyGrid`
- **CRITICAL:** `HoldTxFreq=true`, `AutoSeq=true` (required for autonomous operation)
- Operating mode: `Mode=FT8`
- UI settings, wide graph, rig control, etc.

Implementation: `src/wsjtx/WsjtxConfig.ts`

#### 13.2 Process Launch

For each channel (0-3):

```bash
wsjtx.exe --rig-name=Slice-A --udp-server=127.0.0.1 --udp-port=2237
wsjtx.exe --rig-name=Slice-B --udp-server=127.0.0.1 --udp-port=2238
wsjtx.exe --rig-name=Slice-C --udp-server=127.0.0.1 --udp-port=2239
wsjtx.exe --rig-name=Slice-D --udp-server=127.0.0.1 --udp-port=2240
```

Implementation: `src/wsjtx/ProcessManager.ts`

---

### 14. FlexRadio Integration

#### 14.1 FlexClient Interface

```ts
interface FlexClient {
  connect(host: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  getSlices(): FlexSlice[];
  tuneSlice(index: number, freq_hz: number): void;
  setSliceMode(index: number, mode: string): void;
  setSliceTx(index: number, enable: boolean): void;

  on(event: 'slice_updated', cb: (slice: FlexSlice) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;
}
```

Implementation:
- High-level wrapper: `src/flex/FlexClient.ts`
- VITA-49 protocol: `src/flex/Vita49Client.ts`
- UDP discovery: `src/flex/FlexDiscovery.ts`

---

### 15. Logbook Management

#### 15.1 ADIF Storage

- **Format**: ADIF 3.x
- **Default path**: `%APPDATA%\wsjt-x-mcp\mcp_logbook.adi`
- **Encoding**: UTF-8

#### 15.2 WorkedIndex

In-memory index for duplicate detection:

```ts
type WorkedIndexEntry = {
  call: string;
  band: string;
  mode: string;
  last_qso_time: string;  // ISO8601
};

// Key: "CALL:BAND:MODE"
Map<string, WorkedIndexEntry>
```

Implementation: `src/logbook/LogbookManager.ts`

---

### 16. QSO State Machine

Autonomous QSO handling with state transitions:

```
IDLE → CALLING_CQ → WAITING_REPLY → SENDING_REPORT →
WAITING_REPORT → SENDING_RR73 → WAITING_73 → COMPLETE
```

- **State timeout**: 15 seconds (configurable)
- **Max retries**: 3 (configurable)
- **Pattern matching**: Regex-based message detection
- **Signal reports**: `+XX` or `-XX` format

Implementation: `src/wsjtx/QsoStateMachine.ts`

---

### 17. Web Dashboard

Optional HTTP + WebSocket server for monitoring:

- **Port**: 3000 (default, configurable)
- **Frontend**: React 19 + Vite + Tailwind CSS v4
- **Transport**: Express + WebSocket
- **Serves**: `frontend/dist/`

Implementation:
- Backend: `src/web/server.ts`
- Frontend: `frontend/src/`

---

## Part III – AI Client Guidelines

### 18. Recommended AI Workflow

#### 18.1 Startup

1. Connect to MCP server via stdio
2. Poll `wsjt-x://decodes` resource to get initial snapshot
3. Call `rig_get_state` to understand rig configuration (optional)

#### 18.2 Main Loop

1. **Poll decodes** (every 5-15 seconds):
   ```
   GET wsjt-x://decodes
   ```

2. **Filter for answerable CQs**:
   ```ts
   const answerableCQs = snapshot.decodes.filter(d =>
     d.is_cq &&
     d.is_directed_cq_to_me &&
     !d.low_confidence
   );
   ```

3. **Decision logic**:
   - Select best CQ to answer (by SNR, rarity, etc.)
   - Call `answer_decoded_station` with decode_id
   - OR call `call_cq` to start calling on a band

4. **Safety**:
   - If anything goes wrong, call `rig_emergency_stop`

#### 18.3 Event-Driven (Future)

Once `resources/updated` events are implemented:

1. Subscribe to `resources/updated` for `wsjt-x://decodes`
2. React to new decode snapshots as they arrive
3. No need to poll

---

### 19. Best Practices for AI Agents

#### 19.1 DO

- ✅ Trust `is_directed_cq_to_me` (server is authoritative)
- ✅ Use `decode_id` from snapshot to answer stations
- ✅ Handle duplicate warnings gracefully (server logs them)
- ✅ Call `rig_emergency_stop` if uncertain
- ✅ Poll `wsjt-x://decodes` regularly (5-15 second intervals)

#### 19.2 DON'T

- ❌ Don't reimplement CQ targeting logic
- ❌ Don't try to manage slices/channels directly (server handles routing)
- ❌ Don't answer CQs where `is_directed_cq_to_me === false`
- ❌ Don't answer `low_confidence` decodes
- ❌ Don't poll faster than 5 seconds (server debounces at 500ms)



## Chapter X – Audio empty Slot detector (WASM FFT) 

This chapter documents the Audio Slot Analyzer using WebAssembly PFFFT.

### Purpose
Processes 48 kHz mono audio, computes STFT with 4096‑point FFT, tracks per‑slot long-term energy, and produces ranked FT8/FT4 TX empty slot candidates.

### Technology
- Node.js / TypeScript
- Mandatory WebAssembly PFFFT (4096 FFT)
- No fallback allowed

### STFT
- Fs = 48000 Hz
- FFT = 4096
- Hop = 1024
- Window = Hann
- Bin spacing ≈ 11.71875 Hz

### Slot Grid
- Default spacing: 10 Hz
- Band: 0–3000 Hz
- Per-slot 60s history

### Evaluation Widths
- FT8: ±25 Hz (≈ ±2 bins)
- FT4: ±50 Hz (≈ ±4 bins)

### Long-Term Score
- Median of last 60 seconds
- If <10 samples → INSUFFICIENT_DATA

### Forbidden Criteria
- Nearby decodes: FT8 ±25 Hz / FT4 ±50 Hz
- Strong neighbors: high energy within ±50/100 Hz
- Band edges: ±50 Hz guard

### Candidate Selection
- Only slots with NONE forbidden
- Sort by score ascending
- Optional bias to current TX DF

### Initialization
The analyzer **must load pffft.wasm** on startup.  
If WASM cannot be loaded or initialized, initialization **must fail**.