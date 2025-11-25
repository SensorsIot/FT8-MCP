# WSJT-X MCP Server - Functional Specification Document

## 1. Introduction
This document outlines the functional specifications for the WSJT-X Model Context Protocol (MCP) server. The system acts as a bridge between AI agents and multiple instances of WSJT-X software, enabling the agent to monitor radio traffic, analyze signals, and autonomously conduct QSOs on digital modes like FT8 and FT4.

## 2. Scope
The system provides:
- **Multi-Instance Support**: Launch and control multiple WSJT-X instances simultaneously
- **Friendly Addressing**: Identify instances by rig name or friendly identifiers
- **Live Monitoring**: Real-time stream of decoded messages and status updates from all instances
- **Autonomous QSO Execution**: Fire-and-forget QSO management with full state machine handling the complete exchange sequence
- **Dual Operation Modes**:
    - **FlexRadio Mode**: Dynamic "Slice Master" integration for SmartSDR
    - **Standard Mode**: Direct control for traditional rigs (default: IC-7300)
- **Web Dashboard**: Real-time monitoring and manual control interface

## 3. Architecture

### 3.1. System Components
- **Co-location Requirement**: MCP Server and all WSJT-X instances run on the same physical machine (Windows PC or Raspberry Pi). AI Agent can be remote.
- **MCP Server** (Node.js/TypeScript):
    - Manages WSJT-X process lifecycle (spawn/terminate)
    - Aggregates UDP traffic from localhost on port 2237
    - Implements QSO state machine for autonomous operation
    - Exposes MCP protocol via stdio transport
    - Hosts web dashboard on port 3000
- **WSJT-X Instances**: Multiple WSJT-X processes, each identified by `--rig-name` parameter
- **FlexRadio Integration** (Mode A only): Connects to SmartSDR via VITA 49 protocol
- **MCP Client**: AI agent (Claude, ChatGPT, Gemini) connecting via MCP protocol

### 3.2. Operation Modes

#### Mode A: FlexRadio (Advanced)
- Connects to FlexRadio via VITA 49 protocol (TCP port 4992)
- Monitors slice additions/removals/updates in real-time
- Automatically launches WSJT-X instance for each digital slice
- Automatically terminates WSJT-X when slice is removed
- Syncs frequency/mode configuration between SmartSDR and WSJT-X
- Managed by `SliceMasterLogic` component
- Audio via DAX (Digital Audio eXchange) virtual devices
- **Built-in CAT Server**: Integrated Kenwood TS-2000 compatible CAT server (no external SmartCAT required)
  - Listens on TCP ports 7831, 7832, 7833, 7834 (one per slice A, B, C, D)
  - WSJT-X configured for "Ham Radio Deluxe" rig type
  - Translates CAT commands to FlexRadio API calls
- Instance naming convention: "Slice-A", "Slice-B", "Slice-C", "Slice-D"

#### Mode B: Standard (Basic)
- Default configuration for IC-7300 (configurable for other rigs)
- AI agent or user manually starts/stops WSJT-X instances via MCP tools
- Single instance operation (can manage multiple if manually configured)
- Fixed rig configuration per instance
- WSJT-X configured directly for rig CAT control

### 3.3. System Block Diagrams

#### Standard Mode Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                         Windows PC                                   │
│  ┌─────────────┐                              ┌─────────────────┐   │
│  │  AI Agent   │◄──────MCP/stdio─────────────►│   MCP Server    │   │
│  │  (Claude)   │                              │   (Node.js)     │   │
│  └─────────────┘                              └────────┬────────┘   │
│                                                        │            │
│                                               ┌────────▼────────┐   │
│                                               │  WsjtxManager   │   │
│                                               └────────┬────────┘   │
│                                                        │            │
│        ┌───────────────────────────────────────────────┼──────┐     │
│        │                                               │      │     │
│        ▼                                               ▼      │     │
│  ┌───────────┐    UDP 2237     ┌─────────────┐  ┌──────────┐ │     │
│  │UdpListener│◄────────────────│   WSJT-X    │◄─│ Process  │ │     │
│  └─────┬─────┘                 │  Instance   │  │ Manager  │ │     │
│        │                       └──────┬──────┘  └──────────┘ │     │
│        │                              │                      │     │
│        ▼                              │ CAT/Audio            │     │
│  ┌───────────┐                        ▼                      │     │
│  │  QSO      │                 ┌─────────────┐               │     │
│  │  State    │                 │    Radio    │               │     │
│  │  Machine  │                 │  (IC-7300)  │               │     │
│  └─────┬─────┘                 └─────────────┘               │     │
│        │                                                     │     │
│        ▼                                                     │     │
│  ┌───────────┐    UDP 2237     ┌─────────────┐               │     │
│  │ UdpSender │────────────────►│   WSJT-X    │               │     │
│  └───────────┘                 └─────────────┘               │     │
│        └─────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌─────────────┐                              ┌─────────────────┐   │
│  │ Web Browser │◄─────HTTP:3000/WS───────────►│  Web Dashboard  │   │
│  └─────────────┘                              └─────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

#### FlexRadio Mode Architecture
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Windows PC                                      │
│  ┌─────────────┐                                   ┌─────────────────┐      │
│  │  AI Agent   │◄──────────MCP/stdio──────────────►│   MCP Server    │      │
│  │  (Claude)   │                                   │   (Node.js)     │      │
│  └─────────────┘                                   └────────┬────────┘      │
│                                                             │               │
│                    ┌────────────────────────────────────────┼───────┐       │
│                    │                                        │       │       │
│                    ▼                                        ▼       │       │
│            ┌─────────────┐                          ┌─────────────┐ │       │
│            │ FlexClient  │                          │WsjtxManager │ │       │
│            │ (VITA 49)   │                          └──────┬──────┘ │       │
│            └──────┬──────┘                                 │        │       │
│                   │                                        │        │       │
│                   │ TCP 4992                               │        │       │
│                   │ (slice events)                         │        │       │
│                   ▼                                        │        │       │
│            ┌─────────────┐                                 │        │       │
│            │SliceMaster  │◄────────────────────────────────┘        │       │
│            │   Logic     │                                          │       │
│            └──────┬──────┘                                          │       │
│                   │                                                 │       │
│                   │ auto-launch/terminate                           │       │
│                   ▼                                                 │       │
│  ┌────────────────────────────────────────────────────────────────┐ │       │
│  │              Per-Slice WSJT-X Instances                        │ │       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │ │       │
│  │  │  WSJT-X     │  │  WSJT-X     │  │  WSJT-X     │  ...        │ │       │
│  │  │  Slice A    │  │  Slice B    │  │  Slice C    │             │ │       │
│  │  │ --rig-name  │  │ --rig-name  │  │ --rig-name  │             │ │       │
│  │  │  =SliceA    │  │  =SliceB    │  │  =SliceC    │             │ │       │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │ │       │
│  │         │                │                │                    │ │       │
│  │         │ UDP 2237       │ UDP 2237       │ UDP 2237           │ │       │
│  │         │ (all instances)│                │                    │ │       │
│  │         └────────────────┼────────────────┘                    │ │       │
│  │                          ▼                                     │ │       │
│  │                   ┌─────────────┐                              │ │       │
│  │                   │ UdpListener │──────────────────────────────┼─┘       │
│  │                   └─────────────┘                              │         │
│  │                                                                │         │
│  │         CAT Server TCP   DAX Audio                             │         │
│  │         ┌────────────────┬────────────────┐                    │         │
│  │         │ Port 7831      │ DAX RX 1       │◄── Slice A         │         │
│  │         │ Port 7832      │ DAX RX 2       │◄── Slice B         │         │
│  │         │ Port 7833      │ DAX RX 3       │◄── Slice C         │         │
│  │         │ Port 7834      │ DAX RX 4       │◄── Slice D         │         │
│  │         └────────┬───────┴───────┬────────┘                    │         │
│  └──────────────────┼───────────────┼─────────────────────────────┘         │
│                     │               │                                       │
│                     ▼               ▼                                       │
│            ┌──────────────────────────────────┐                             │
│            │         SmartSDR                 │                             │
│            │  ┌────────┐ ┌────────┐           │                             │
│            │  │Slice A │ │Slice B │ ...       │                             │
│            │  │ 20m FT8│ │ 40m FT8│           │                             │
│            │  └────────┘ └────────┘           │                             │
│            └───────────────┬──────────────────┘                             │
│                            │                                                │
└────────────────────────────┼────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   FlexRadio     │
                    │  (FLEX-6600)    │
                    └─────────────────┘
```

#### FlexRadio Audio/CAT Data Flow
```
┌─────────────────────────────────────────────────────────────────────┐
│                    WSJT-X ◄──► FlexRadio Integration                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   WSJT-X Instance                MCP Server           FlexRadio     │
│  ┌─────────────────┐         ┌─────────────┐     ┌─────────────┐   │
│  │                 │         │             │     │             │   │
│  │  Audio Input    │◄────────│─────────────│─────│ DAX RX 1    │   │
│  │  "DAX RX 1"     │         │             │     │             │   │
│  │                 │         │             │     │             │   │
│  │  Audio Output   │─────────│─────────────│────►│ DAX TX      │   │
│  │  "DAX TX"       │         │             │     │             │   │
│  │                 │         │             │     │             │   │
│  │  CAT Control    │◄───────►│  CatServer  │────►│ VITA 49     │   │
│  │  127.0.0.1:7831 │ Kenwood │  (built-in) │     │ slice tune  │   │
│  │  (Ham Radio DX) │ TS-2000 │             │     │ slice set   │   │
│  └─────────────────┘         └─────────────┘     └─────────────┘   │
│                                                                     │
│  CAT Command Translation:                                           │
│  • FA00014074000; → slice tune 0 14.074 (frequency)                 │
│  • MD9;           → slice set 0 mode=DIGU (mode)                    │
│  • TX;            → xmit 1 (PTT on)                                 │
│  • RX;            → xmit 0 (PTT off)                                │
│                                                                     │
│  WSJT-X INI Configuration (auto-configured):                        │
│  • Rig: Ham Radio Deluxe                                            │
│  • CATNetworkPort: 127.0.0.1:7831 (7832, 7833, 7834 for B,C,D)     │
│  • SoundInName: DAX Audio RX 1 (FlexRadio Systems DAX Audio)       │
│  • SoundOutName: DAX Audio TX (FlexRadio Systems DAX TX)           │
│  • PTTMethod: CAT                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4. Message Flow (Internal)
```
AI Agent <--MCP/stdio--> McpServer
                           ↓
                      WsjtxManager
                      ↓         ↓
                UdpListener  ProcessManager (Standard) / SliceMasterLogic (Flex)
                      ↓         ↓
              QsoStateMachine  WSJT-X Process(es)
                      ↓         ↓
                  UdpSender ←---
```

## 4. Exposed Functionalities

### 4.1. Instance Management
- **List Instances**: View all running WSJT-X instances with name, UDP port, and running status
- **Start Instance** (Standard Mode only): Launch new WSJT-X process with specific rig configuration
- **Stop Instance**: Gracefully terminate a running WSJT-X instance

### 4.2. Monitoring & Decoding
- **Live Decodes**: Real-time stream of decoded messages including:
    - Message text
    - SNR (Signal-to-Noise Ratio)
    - Delta time
    - Delta frequency
    - Decode time
    - Instance ID
- **Status Updates**: Monitor operational state:
    - Current frequency (dial frequency in Hz)
    - Operating mode (FT8, FT4, etc.)
    - Transmit/Receive state
    - Configuration status
- **Heartbeat Monitoring**: Track instance health via periodic heartbeat messages

### 4.3. Operation & Automation

#### Execute Full QSO (Autonomous)
The system provides a complete autonomous QSO capability that manages the entire contact sequence:

**Functionality**: Fire-and-forget QSO execution. AI agent provides target callsign, own callsign, and grid locator. The server autonomously completes the QSO.

**State Machine Sequence**:
1. **IDLE**: Initial state
2. **CALLING_CQ**: Transmits "CQ [MYCALL] [MYGRID]"
3. **WAITING_REPLY**: Listens for station calling us (15-second timeout, max 3 retries)
4. **SENDING_REPORT**: Transmits "[THEIRCALL] [MYCALL] [REPORT]" (e.g., +15, -03)
5. **WAITING_REPORT**: Listens for their signal report (15-second timeout)
6. **SENDING_RR73**: Transmits "[THEIRCALL] [MYCALL] RR73"
7. **WAITING_73**: Listens for final 73 acknowledgment (15-second timeout)
8. **COMPLETE**: QSO successfully completed
9. **FAILED**: QSO failed (timeout, max retries exceeded)

**Error Handling**:
- Configurable timeout per state (default: 15 seconds, matching FT8 cycle)
- Configurable retry count (default: 3 attempts)
- Automatic failure on timeout or max retries
- Events emitted on completion/failure for AI awareness

**Message Parsing**:
- Regex-based pattern matching to identify callsigns and reports
- Auto-formats signal reports (SNR to +XX or -XX format)
- Validates message structure at each state transition

## 5. MCP Protocol Interface

### 5.1. MCP Tools
Tools exposed to AI agents via MCP protocol:

#### `start_instance`
**Parameters**:
- `name` (string, required): Friendly name for the instance
- `band` (string, optional): Target band (e.g., "20m", "40m")
- `rigName` (string, optional): Rig name configuration

**Behavior**:
- Only available in STANDARD mode (returns error in FLEX mode)
- Spawns new WSJT-X process with `--rig-name` parameter
- Auto-assigns UDP port starting from 2237

**Returns**: Success message or error

#### `stop_instance`
**Parameters**:
- `name` (string, required): Friendly name of instance to stop

**Behavior**:
- Sends SIGTERM to WSJT-X process
- Force kills with SIGKILL after 5-second timeout if needed
- Removes instance from active registry

**Returns**: Success or "Instance not found" error

#### `execute_qso`
**Parameters**:
- `instanceId` (string, required): Instance ID (rig name)
- `targetCallsign` (string, required): Target station callsign
- `myCallsign` (string, required): Your callsign
- `myGrid` (string, required): Your grid locator (e.g., "FN20")

**Behavior**:
- Creates new QsoStateMachine for the instance
- Fails if QSO already in progress for that instance
- Autonomously manages complete QSO sequence
- Emits events on completion/failure

**Returns**: Success message or error

### 5.2. MCP Resources
Resources exposed for AI agent queries:

#### `wsjt-x://instances`
**Type**: JSON list
**Content**: Array of instance objects containing:
- `name`: Instance friendly name
- `udpPort`: UDP port number
- `running`: Boolean status

**Use Case**: AI agent queries active instances before starting operations

### 5.3. Event Stream
The system emits events via WsjtxManager EventEmitter:
- `decode`: New decoded message from any instance
- `status`: Status update from any instance
- `qso-complete`: QSO successfully completed
- `qso-failed`: QSO failed (with reason)

## 6. WSJT-X Integration

### 6.1. UDP Protocol
- **Port**: 2237 (WSJT-X default)
- **Format**: Qt QDataStream (QQT encoding)
- **Magic Number**: 0xadbccbda
- **Schema Version**: 2

### 6.2. Message Types
Handled message types (defined in `src/wsjtx/types.ts`):
- **Heartbeat** (0): Instance health check
- **Status** (1): Operational status updates
- **Decode** (2): Decoded message data
- **Clear** (3): Clear decode window
- **Reply** (4): Reply to specific station (outgoing)
- **QSO Logged** (5): QSO logged to file
- **Close** (6): Instance closing
- **Replay** (7): Replay request
- **Halt Tx** (8): Stop transmission (outgoing)
- **Free Text** (9): Free text message (outgoing)
- **WSPR Decode** (10): WSPR-specific decode

### 6.3. Process Management
- **WSJT-X Path**: Default `C:\WSJT\wsjtx\bin\wsjtx.exe` (Windows), configurable
- **Instance Identification**: Uses `--rig-name` command-line parameter
- **Lifecycle**: Spawned via Node.js `child_process`, detached=false, stdio=ignore
- **Shutdown**: Graceful SIGTERM, force SIGKILL after 5 seconds

## 7. FlexRadio Integration

### 7.1. VITA 49 Protocol
- **Default Host**: 255.255.255.255 (broadcast discovery), configurable
- **Default Port**: 4992
- **Protocol**: VITA 49 packet format for SDR control
- **Commands Implemented**:
  - `sub slice all` - Subscribe to slice events
  - `slice list` - Get current slice list
  - `slice tune <index> <freq_mhz>` - Tune slice to frequency
  - `slice set <index> mode=<mode>` - Set slice mode
  - `xmit <0|1>` - PTT control

### 7.2. Built-in CAT Server
The MCP server includes a built-in CAT server that eliminates the need for external SmartCAT software:

- **Protocol**: Kenwood TS-2000 compatible CAT commands over TCP
- **Ports**: 7831 (Slice A), 7832 (Slice B), 7833 (Slice C), 7834 (Slice D)
- **Rig Type in WSJT-X**: "Ham Radio Deluxe"
- **Supported Commands**:
  - `FA;` / `FA<freq>;` - Query/Set VFO A frequency
  - `FB;` / `FB<freq>;` - Query/Set VFO B frequency
  - `IF;` - Transceiver info (frequency, mode, TX state)
  - `MD;` / `MD<mode>;` - Query/Set mode
  - `TX;` / `RX;` - PTT control
  - `TQ;` - TX state query
  - `ID;` - Radio ID (returns TS-2000)
  - `PS;` - Power status
  - `AI;` - Auto-information mode

**Implementation**: `src/flex/CatServer.ts`
- `CatServer` class: Single-slice CAT server
- `CatServerManager` class: Manages multiple CAT servers (one per slice)
- Events emitted: `frequency-change`, `mode-change`, `ptt-change`

### 7.3. Slice Master Logic
- **Slice Detection**: Monitors `slice-added`, `slice-removed`, `slice-updated` events
- **Auto-Launch**: Creates WSJT-X instance when slice added (any mode)
- **Auto-Terminate**: Stops WSJT-X instance when slice removed
- **CAT Server**: Starts CAT server before launching WSJT-X
- **State Sync**: Updates CAT server when FlexRadio reports slice changes
- **Instance Mapping**: Maintains slice ID to WSJT-X instance mapping
- **Naming**: Instances named "Slice-A", "Slice-B", etc.

### 7.4. WSJT-X INI Configuration
The system auto-configures WSJT-X INI files before launching:

**Implementation**: `src/wsjtx/WsjtxConfig.ts`

**Configured Settings**:
- `Rig=Ham Radio Deluxe`
- `CATNetworkPort=127.0.0.1:<port>` (combined IP:port format)
- `PTTMethod=CAT`
- `SoundInName=DAX Audio RX <n> (FlexRadio Systems DAX Audio)`
- `SoundOutName=DAX Audio TX (FlexRadio Systems DAX TX)`
- `AudioInputChannel=Mono`
- `AudioOutputChannel=Mono`

**Wide Graph Settings**:
- `BinsPerPixel` - Calculated for 2500 Hz display
- `PlotWidth` - Calculated based on window size
- `StartFreq=0`
- `HideControls=true`

## 8. Web Dashboard

### 8.1. Server Configuration
- **Framework**: Express 5.x
- **Port**: 3000 (configurable via environment)
- **WebSocket**: ws library for real-time updates
- **CORS**: Enabled for development

### 8.2. Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 6.x
- **Styling**: Tailwind CSS v4 with PostCSS
- **Dev Server**: Hot module replacement via Vite

### 8.3. Features
- **Mission Control**: Unified view of all WSJT-X instances
- **Real-time Updates**: WebSocket-driven status updates
- **Live Decodes**: Streaming decode display
- **Manual Control**: Override AI actions when needed
- **Action Log**: System event history

## 9. Technical Implementation

### 9.1. Technology Stack
- **Runtime**: Node.js v18+
- **Language**: TypeScript (ES2022 target)
- **Module System**: CommonJS (backend), ESM (frontend)
- **MCP SDK**: @modelcontextprotocol/sdk v1.22+
- **Validation**: Zod v4.x for schema validation
- **Process Control**: Node.js child_process module

### 9.2. Configuration

Configuration is stored in `config.json` and can be edited via the Web Dashboard Settings page.

#### Common Parameters (Both Modes)
| Parameter | Description | Default |
|-----------|-------------|---------|
| `mode` | Operation mode: "STANDARD" or "FLEX" | STANDARD |
| `wsjtx.path` | Path to WSJT-X executable | C:\WSJT\wsjtx\bin\wsjtx.exe |
| `station.callsign` | Your callsign (for QSO automation) | (empty) |
| `station.grid` | Your grid locator (for QSO automation) | (empty) |

#### Standard Mode Parameters
| Parameter | Description | Default |
|-----------|-------------|---------|
| `standard.rigName` | Rig name for WSJT-X instance identification | IC-7300 |

#### FlexRadio Mode Parameters
| Parameter | Description | Default |
|-----------|-------------|---------|
| `flex.host` | FlexRadio/SmartSDR IP address | 127.0.0.1 (auto-discovered) |
| `flex.catBasePort` | Starting TCP port for CAT server (increments per slice) | 7831 |

#### Example config.json (Standard Mode)
```json
{
  "mode": "STANDARD",
  "wsjtx": {
    "path": "C:\\WSJT\\wsjtx\\bin\\wsjtx.exe"
  },
  "station": {
    "callsign": "W1ABC",
    "grid": "FN31"
  },
  "standard": {
    "rigName": "IC-7300"
  }
}
```

#### Example config.json (FlexRadio Mode)
```json
{
  "mode": "FLEX",
  "wsjtx": {
    "path": "C:\\WSJT\\wsjtx\\bin\\wsjtx.exe"
  },
  "station": {
    "callsign": "W1ABC",
    "grid": "FN31"
  },
  "flex": {
    "host": "auto",
    "catBasePort": 7831
  }
}
```

**Note**: When `flex.host` is "auto" or not specified, the system will auto-discover FlexRadio on the network via broadcast UDP.

Configuration validated via Zod schemas in `src/config.ts`

### 9.3. State Management
- **EventEmitter Pattern**: All major components extend EventEmitter
- **Async/Await**: Promise-based async operations throughout
- **Error Handling**: Try-catch blocks with error propagation to AI agent
- **Timeout Management**: NodeJS.Timeout for state machine timeouts

### 9.4. Deployment
- **Development**: `npm install && npm start`
- **Production Build**: `npx tsc` to compile TypeScript
- **Output**: dist/ directory with CommonJS modules
- **Frontend Build**: `cd frontend && npm run build`
- **Single Binary**: Future support for pkg or bun compilation

## 10. Future Enhancements

### 10.1. Not Yet Implemented
The following FSD features are not yet implemented:

**MCP Tools**:
- `set_parameter`: Generic parameter setting
- `call_cq`: Standalone CQ call (currently part of execute_qso)
- `reply_to_station`: Direct reply without full QSO (currently part of execute_qso)
- `halt_tx`: Emergency transmission stop
- `set_frequency`: Direct frequency control
- `set_mode`: Direct mode switching

**MCP Resources**:
- `wsjt-x://{name}/decodes`: Instance-specific decode stream
- `wsjt-x://{name}/status`: Instance-specific status

**Monitoring**:
- Station info (own callsign/grid) not exposed as MCP resource
- Configuration parameters not exposed as MCP resource

### 10.2. Planned Features
- Pre-built binaries for Windows x64 and Raspberry Pi ARM64
- Extended rig control tools (frequency, mode, parameters)
- Individual instance decode/status resources
- Enhanced error recovery in QSO state machine
- Logging to file for QSOs and events
- Configuration UI in web dashboard

## 11. Status
- ✅ Core architecture implemented
- ✅ Both operation modes (FLEX and STANDARD) functional
- ✅ QSO state machine complete
- ✅ Process management operational
- ✅ UDP protocol implementation complete
- ✅ MCP server with stdio transport
- ✅ Web dashboard basic implementation
- ✅ FlexRadio VITA 49 integration
- ✅ **Built-in CAT server** (Kenwood TS-2000 compatible) - No external SmartCAT needed
- ✅ **Auto-configuration of WSJT-X INI files** (rig, audio, wide graph settings)
- ✅ **FlexRadio auto-discovery** via UDP broadcast
- ✅ **Slice-aware instance naming** (Slice-A, Slice-B, etc.)
- ✅ **Bidirectional CAT control** (WSJT-X → FlexRadio frequency/mode/PTT)
- ⏳ Additional MCP tools pending
- ⏳ Binary distribution pending
- ⏳ Enhanced web dashboard features pending
