# 📡 WSJT-X MCP Server

![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)
![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-In_Development-orange?style=for-the-badge)

**Control your Amateur Radio station with AI.**

The **WSJT-X MCP Server** bridges the gap between modern AI agents (like Claude, ChatGPT, or Gemini) and the popular **WSJT-X** software. It enables your AI assistant to monitor radio traffic, analyze signals, and autonomously conduct QSOs on modes like FT8 and FT4.

---

## ✨ Features

- **🤖 AI-Driven Control**: Exposes WSJT-X functionality via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).
- **📻 Multi-Instance Support**: Control multiple radios/bands simultaneously from a single AI session.
- **⚡ Autonomous QSOs**: "Fire-and-forget" QSO automation—tell the AI to "work that station," and the server handles the Tx sequence (Tx1-Tx5 -> 73).
- **💻 Windows Native**: Designed primarily for Windows, with optional support for Raspberry Pi.
- **📻 FlexRadio Optimized**: Built specifically for **SmartSDR** integration.
- **🔗 Slice Master Integration**: Automatically detects active FlexRadio slices and launches WSJT-X instances for them.
- **🖥️ Web Dashboard**: Premium "Mission Control" web interface for real-time monitoring and manual override.
- **🔊 Live Monitoring**: Stream decoded messages and signal reports directly to the AI context.

## 🚀 Architecture

The MCP Server runs locally on the same machine as your WSJT-X instances (PC or Raspberry Pi). It acts as a middleware, translating MCP requests from the AI Agent into UDP commands for WSJT-X.

```mermaid
graph LR
    AI[🤖 AI Agent] <-->|MCP Protocol| Server[📡 MCP Server]
    Server <-->|UDP :2237| Radio1[📻 WSJT-X (20m)]
    Server <-->|UDP :2238| Radio2[📻 WSJT-X (40m)]
```

## 🛠️ Capabilities

| Category | Functionality |
|----------|---------------|
| **Management** | Start/Stop instances, List active radios |
| **Monitoring** | Live decodes, Frequency/Mode status, Signal reports |
| **Control** | Set Frequency, Change Mode, Adjust Audio |
| **Automation** | Call CQ, Reply to Station, **Execute Full QSO** |
| **Visualization** | **Web Dashboard**, Waterfall status, Action Logs |

## 📦 Installation

> ⚠️ **Note**: This project is currently in active development.

### Prerequisites
- **Node.js** (v18+)
- **WSJT-X** installed and running

### Quick Start
```bash
# Clone the repository
git clone https://github.com/SensorsIot/wsjt-x-MCP.git

# Install dependencies
cd wsjt-x-MCP
npm install

# Run the server
npm start
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
