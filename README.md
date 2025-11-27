# WSJT-X MCP Server

![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-In_Development-orange?style=for-the-badge)

**Control your Amateur Radio station with AI.**

The **WSJT-X MCP Server** bridges the gap between modern AI agents (like Claude, ChatGPT, or Gemini) and the popular **WSJT-X** software. It enables your AI assistant to monitor radio traffic, analyze signals, and autonomously conduct QSOs on modes like FT8 and FT4.

---

## Features

- **AI-Driven Control**: Exposes WSJT-X functionality via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).
- **Multi-Instance Support**: Control multiple radios/bands simultaneously from a single AI session.
- **Autonomous QSOs**: "Fire-and-forget" QSO automation—tell the AI to "work that station," and the server handles the complete exchange sequence.
- **Windows Native**: Designed primarily for Windows, with optional support for Raspberry Pi.
- **Dual Operation Modes**:
    - **FlexRadio Mode**: Auto-launch WSJT-X instances for each slice with built-in CAT server (no external SmartCAT needed).
    - **Standard Mode**: Direct control for standard rigs (default: **IC-7300**).
- **Web Dashboard**: Real-time monitoring and manual control interface on port 3000.
- **Live Monitoring**: Stream decoded messages and signal reports directly to the AI context.

## Architecture

The MCP Server runs locally on the same machine as your WSJT-X instances (PC or Raspberry Pi). It acts as a middleware, translating MCP requests from the AI Agent into UDP commands for WSJT-X.

### Standard Mode
```
AI Agent <--MCP/stdio--> MCP Server <--UDP 2237--> WSJT-X <--CAT--> Radio (IC-7300)
```

### FlexRadio Mode
```
AI Agent <--MCP/stdio--> MCP Server
                              |
              +---------------+---------------+
              |               |               |
         FlexClient    FlexRadio       HrdCatServer
         (VITA 49)      Manager        (HRD Protocol)
              |               |               |
              +-------+-------+-------+-------+
                      |               |
                  SmartSDR        WSJT-X
                      |          Instances
                  FlexRadio     (per slice)
```

**FlexRadio Features:**
- Auto-discovery of FlexRadio on the network
- Auto-launch WSJT-X instance for each slice
- Built-in HRD CAT server (ports 7809-7812)
- Bidirectional control: WSJT-X frequency/mode/PTT changes sync to FlexRadio
- Auto-configuration of WSJT-X INI files (audio, rig, wide graph)

## Capabilities

| Category | Functionality |
|----------|---------------|
| **Management** | Start/Stop instances, List active radios |
| **Monitoring** | Live decodes, Frequency/Mode status, Signal reports |
| **Control** | Set Frequency, Change Mode, PTT control |
| **Automation** | Call CQ, Reply to Station, **Execute Full QSO** |
| **Visualization** | **Web Dashboard** (port 3000), Action Logs |

## Installation

### Prerequisites
- **Node.js** (v18+)
- **WSJT-X** installed (default: `C:\WSJT\wsjtx\bin\wsjtx.exe`)
- For FlexRadio mode: **SmartSDR** running

### Quick Start
```bash
# Clone the repository
git clone https://github.com/SensorsIot/wsjt-x-MCP.git
cd wsjt-x-MCP

# Install dependencies
npm install

# Build TypeScript
npx tsc

# Run the server
npm start
```

### Web Dashboard
```bash
cd frontend
npm install
npm run dev    # Development with hot reload
# or
npm run build  # Production build
```

Access the dashboard at: http://localhost:3000

## Configuration

Configuration is stored in `config.json`:

### Standard Mode (default)
```json
{
  "mode": "STANDARD",
  "wsjtx": {
    "path": "C:\\WSJT\\wsjtx\\bin\\wsjtx.exe"
  },
  "station": {
    "callsign": "YOUR_CALL",
    "grid": "YOUR_GRID"
  },
  "standard": {
    "rigName": "IC-7300"
  }
}
```

### FlexRadio Mode
```json
{
  "mode": "FLEX",
  "wsjtx": {
    "path": "C:\\WSJT\\wsjtx\\bin\\wsjtx.exe"
  },
  "station": {
    "callsign": "YOUR_CALL",
    "grid": "YOUR_GRID"
  },
  "flex": {
    "host": "auto",
    "catBasePort": 7831
  }
}
```

### Environment Variables
- `WSJTX_MODE`: Set to `FLEX` for FlexRadio mode (default: `STANDARD`)
- `FLEX_HOST`: FlexRadio IP address (default: auto-discovery)
- `RIG_NAME`: Rig name for Standard mode (default: `IC-7300`)

## MCP Tools

The server exposes these tools to AI agents:

| Tool | Description |
|------|-------------|
| `start_instance` | Launch a new WSJT-X instance |
| `stop_instance` | Stop a running instance |
| `execute_qso` | Autonomously complete a QSO with a target station |

## Project Structure

```
wsjt-x-MCP/
├── src/
│   ├── index.ts               # Entry point
│   ├── SettingsManager.ts     # Configuration management
│   │
│   ├── wsjtx/                 # WSJT-X management
│   │   ├── WsjtxManager.ts        # Main orchestrator
│   │   ├── ProcessManager.ts      # WSJT-X process lifecycle
│   │   ├── FlexRadioManager.ts    # FlexRadio slice management
│   │   ├── UdpListener.ts         # UDP message receiver
│   │   ├── UdpSender.ts           # UDP message sender
│   │   ├── QsoStateMachine.ts     # Autonomous QSO handler
│   │   ├── WindowManager.ts       # WSJT-X window positioning
│   │   └── WsjtxConfig.ts         # INI file auto-configuration
│   │
│   ├── state/                 # MCP state management
│   │   ├── StateManager.ts        # Aggregate MCP state
│   │   ├── ChannelUdpManager.ts   # Per-channel UDP
│   │   └── types.ts
│   │
│   ├── logbook/               # Logbook operations
│   │   └── LogbookManager.ts      # ADIF, WorkedIndex, HRD server
│   │
│   ├── dashboard/             # Web dashboard state
│   │   └── DashboardManager.ts    # Station tracking
│   │
│   ├── cat/                   # CAT control
│   │   └── HrdCatServer.ts        # HRD protocol server
│   │
│   ├── flex/                  # FlexRadio backend
│   │   ├── FlexClient.ts          # FlexRadio connection
│   │   ├── Vita49Client.ts        # VITA 49 protocol
│   │   └── FlexDiscovery.ts       # Auto-discovery
│   │
│   ├── mcp/                   # MCP protocol
│   │   └── McpServer.ts           # MCP stdio transport
│   │
│   └── web/                   # Web interface
│       └── server.ts              # Express + WebSocket
│
├── frontend/                  # React web dashboard
├── dist/                      # Compiled JavaScript
└── config.json                # Runtime configuration
```

## Documentation

- **[WSJT-X-MCP-FSD.md](WSJT-X-MCP-FSD.md)** - Full Functional Specification Document
- **[CLAUDE.md](CLAUDE.md)** - Development guide for Claude Code

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
