# WSJT-X MCP Server - Functional Specification Document

## 1. Introduction
This document outlines the functional specifications for the WSJT-X Model Context Protocol (MCP) server. The system will act as a bridge between an AI agent and multiple instances of WSJT-X software, enabling the agent to monitor traffic, analyze signals, and control radio operations across different bands.

## 2. Scope
The system will:
- **Multi-Instance Support**: Connect to, **launch**, and control multiple running instances of WSJT-X simultaneously.
- **Friendly Addressing**: Use friendly names (e.g., "20m", "40m") to identify instances.
- **Monitoring**: Listen to status updates and decoded messages from all instances.
- **Control**:
    - Start/Stop WSJT-X instances with specific configurations.
    - Set operational parameters (Frequency, Mode, etc.).
    - Execute CQ calls.
    - Select specific stations to call.
    - **Full Automation**: Manage the entire QSO sequence (Tx1 -> Tx2 -> 73) autonomously.
- **Platform Support**:
    - **Windows**: **Primary Platform**. Fully supported for development and production.
    - **Raspberry Pi**: Supported as a secondary/alternative target platform.
- **Installation**:
    - Simple installation procedure (e.g., single binary or simple script).

## 3. Architecture
- **Co-location Requirement**: The **MCP Server** and all **WSJT-X Instances** MUST run on the same physical machine (e.g., Raspberry Pi or PC). The **AI Agent (LLM)** can be remote.
- **WSJT-X Instances**: Multiple instances running on the local machine.
- **MCP Server**: A central server (Node.js) running on the local machine that:
    - Manages local WSJT-X processes (start/stop).
    - Aggregates UDP traffic from localhost.
    - Implements the QSO state machine.
    - Exposes data via MCP (Stdio or SSE).
- **MCP Client**: The AI agent (local or remote) that connects to the MCP Server.

## 4. Exposed Functionalities
The following capabilities are exposed to the AI Agent:

### 4.1. Instance Management
- **List Instances**: View all available/running WSJT-X instances with their status and configuration.
- **Start Instance**: Launch a new WSJT-X process for a specific band/rig configuration.
- **Stop Instance**: Gracefully terminate a running WSJT-X instance.

### 4.2. Monitoring & Decoding
- **Live Decodes**: Receive a real-time stream of decoded messages (CQ calls, replies, 73s) from any active instance.
- **Status Updates**: Monitor frequency, mode, signal report (SNR), and transceiver status (Tx/Rx).
- **Station Info**: Access own callsign and grid locator settings.

### 4.3. Rig Control
- **Set Frequency**: Tune the radio to a specific frequency.
- **Set Mode**: Switch between modes (e.g., FT8, FT4, JT65).
- **Configuration**: Adjust internal WSJT-X parameters (e.g., Tx audio level).

### 4.4. Operation & Automation
- **Call CQ**: Initiate a CQ call sequence.
- **Reply to Station**: Answer a specific caller.
- **Execute Full QSO**: **(Autonomous)** Trigger a "fire-and-forget" QSO sequence where the MCP server manages the standard FT8/FT4 exchange (Tx1 -> Tx2 -> Tx3 -> Tx4 -> Tx5 -> 73) automatically.
- **Halt Transmission**: Emergency stop of any active transmission.

## 5. Operation Modes

### 5.1. Mode A: FlexRadio (Advanced)
*Functionality copied from Slice Master.*
- **Dynamic Slice Monitoring**: Connects to FlexRadio (Vita49) to detect open Slices.
- **Auto-Launch**: Automatically spawns WSJT-X instances for each digital slice.
- **Configuration Sync**: Syncs DAX/CAT settings automatically.

### 5.2. Mode B: Standard (Basic)
*Traditional control for standard transceivers.*
- **Target Rig**: Default configuration is for **IC-7300**, but configurable for others.
- **Manual/AI Setup**: The AI (or user) specifies the band and rig parameters.
- **Single Instance**: Typically manages one WSJT-X instance connected to the radio.
- **Use Case**: Users without FlexRadio hardware who want AI control of their station.

## 6. MCP Resources
- `wsjt-x://instances`: List of managed instances (Friendly Name, Status, Frequency).
- `wsjt-x://{name}/decodes`: Stream of decoded messages for a specific instance.
- `wsjt-x://{name}/status`: Detailed status of a specific instance.

## 6. MCP Tools
All tools will use `instance_name` (friendly name) to target the correct WSJT-X instance.

### Process Management
- `start_instance(name: string, config: { band: string, rig: string, ... })`: Launch a new WSJT-X instance.
- `stop_instance(name: string)`: Close a WSJT-X instance.

### Operation
- `set_parameter(name: string, parameter: string, value: any)`: Set generic parameters.
- `call_cq(name: string, message?: string)`: Initiate a CQ call.
- `reply_to_station(name: string, callsign: string)`: Initiate a call to a specific station.
- `execute_qso(name: string, target_callsign: string)`: **Autonomous**. Initiates and manages the full QSO sequence until 73 is sent/received.
- `halt_tx(name: string)`: Stop transmission immediately.

## 6. Technical Requirements
- **Language**: **Node.js (TypeScript)**.
    - *Rationale*: Native support for MCP SDK, excellent async I/O for handling multiple UDP streams, and easy cross-compilation to single binaries (using `pkg` or `bun`) for Raspberry Pi and Windows.
- **UDP Listener**: Handle WSJT-X QQT encoding (Qt's `QDataStream`).
- **Process Control**: Use `child_process` to spawn WSJT-X with `--rig-name` or similar arguments.
# WSJT-X MCP Server - Functional Specification Document

## 1. Introduction
This document outlines the functional specifications for the WSJT-X Model Context Protocol (MCP) server. The system will act as a bridge between an AI agent and multiple instances of WSJT-X software, enabling the agent to monitor traffic, analyze signals, and control radio operations across different bands.

## 2. Scope
The system will:
- **Multi-Instance Support**: Connect to, **launch**, and control multiple running instances of WSJT-X simultaneously.
- **Friendly Addressing**: Use friendly names (e.g., "20m", "40m") to identify instances.
- **Monitoring**: Listen to status updates and decoded messages from all instances.
- **Control**:
    - Start/Stop WSJT-X instances with specific configurations.
    - Set operational parameters (Frequency, Mode, etc.).
    - Execute CQ calls.
    - Select specific stations to call.
    - **Full Automation**: Manage the entire QSO sequence (Tx1 -> Tx2 -> 73) autonomously.
- **Operation Modes**:
    - **Mode A: FlexRadio (Advanced)**: Dynamic "Slice Master" style integration for FlexRadio SmartSDR.
    - **Mode B: Standard (Basic)**: Direct control of a single radio (default: **IC-7300**) via standard WSJT-X configuration.
- **Installation**:
    - Simple installation procedure (e.g., single binary or simple script).

## 3. Architecture
- **Co-location Requirement**: The **MCP Server** and all **WSJT-X Instances** MUST run on the same physical machine.
- **Inputs**:
    - **FlexRadio (Mode A)**: Connects to the radio (TCP/UDP) to monitor Slices.
    - **WSJT-X**: Connects to instances (UDP) for decoding/control.
- **MCP Server**: A central server (Node.js) running on the local machine that:
    - **Orchestrator**: 
        - *FlexRadio Mode*: Monitors FlexRadio state and manages WSJT-X processes dynamically.
        - *Standard Mode*: Manages a single WSJT-X instance based on user/AI configuration.
    - Aggregates UDP traffic from localhost.
    - Implements the QSO state machine.
    - Exposes data via MCP (Stdio or SSE).
- **MCP Client**: The AI agent (local or remote) that connects to the MCP Server.

## 4. Exposed Functionalities
The following capabilities are exposed to the AI Agent:

### 4.1. Instance Management
- **List Instances**: View all available/running WSJT-X instances with their status and configuration.
- **Start Instance**: Launch a new WSJT-X process for a specific band/rig configuration.
- **Stop Instance**: Gracefully terminate a running WSJT-X instance.

### 4.2. Monitoring & Decoding
- **Live Decodes**: Receive a real-time stream of decoded messages (CQ calls, replies, 73s) from any active instance.
- **Status Updates**: Monitor frequency, mode, signal report (SNR), and transceiver status (Tx/Rx).
- **Station Info**: Access own callsign and grid locator settings.

### 4.3. Rig Control
- **Set Frequency**: Tune the radio to a specific frequency.
- **Set Mode**: Switch between modes (e.g., FT8, FT4, JT65).
- **Configuration**: Adjust internal WSJT-X parameters (e.g., Tx audio level).

### 4.4. Operation & Automation
- **Call CQ**: Initiate a CQ call sequence.
- **Reply to Station**: Answer a specific caller.
- **Execute Full QSO**: **(Autonomous)** Trigger a "fire-and-forget" QSO sequence where the MCP server manages the standard FT8/FT4 exchange (Tx1 -> Tx2 -> Tx3 -> Tx4 -> Tx5 -> 73) automatically.
- **Halt Transmission**: Emergency stop of any active transmission.

## 5. MCP Resources
- `wsjt-x://instances`: List of managed instances (Friendly Name, Status, Frequency).
- `wsjt-x://{name}/decodes`: Stream of decoded messages for a specific instance.
- `wsjt-x://{name}/status`: Detailed status of a specific instance.

## 7. MCP Tools
All tools will use `instance_name` (friendly name) to target the correct WSJT-X instance.

### Process Management
- `start_instance(name: string, config: { band: string, rig: string, ... })`: Launch a new WSJT-X instance.
- `stop_instance(name: string)`: Close a WSJT-X instance.

### Operation
- `set_parameter(name: string, parameter: string, value: any)`: Set generic parameters.
- `call_cq(name: string, message?: string)`: Initiate a CQ call.
- `reply_to_station(name: string, callsign: string)`: Initiate a call to a specific station.
- `execute_qso(name: string, target_callsign: string)`: **Autonomous**. Initiates and manages the full QSO sequence until 73 is sent/received.
- `halt_tx(name: string)`: Stop transmission immediately.

## 8. Technical Requirements
- **Language**: **Node.js (TypeScript)**.
    - *Rationale*: Native support for MCP SDK, excellent async I/O for handling multiple UDP streams, and easy cross-compilation to single binaries (using `pkg` or `bun`) for Raspberry Pi and Windows.
- **UDP Listener**: Handle WSJT-X QQT encoding (Qt's `QDataStream`).
- **Process Control**: Use `child_process` to spawn WSJT-X with `--rig-name` or similar arguments.
- **State Machine**: Implement a robust state machine for `execute_qso` to handle retries, timeouts, and sequence progression.
- **Libraries**: No external radio libraries (hamlib) needed *in the MCP server* itself, as WSJT-X handles the rig control. The MCP server only communicates with WSJT-X via UDP.
- **Deployment**:
    - Provide pre-built binaries for Windows (x64) and Raspberry Pi (ARM64).
    - `npm` based installation for developers.

## 9. User Interface
The system will provide a **Local Web Dashboard** for visualization and manual control.

### 9.1. Concept
A lightweight web server hosted by the MCP application (e.g., `http://localhost:3000`), accessible via any modern web browser.

### 9.2. Features
- **Mission Control**: Unified view of all connected WSJT-X instances.
- **Live Status Cards**: Real-time display of Frequency, Mode, SNR, and Tx/Rx state per instance.
- **Configuration Panel**: Form to launch new instances and configure global settings.
- **Action Log**: A scrolling log showing AI actions and system events.

### 9.3. Technology
- **Frontend**: React + Vite + Tailwind CSS.
- **Communication**: WebSockets for real-time state updates.

## 10. Open Questions
- None. Requirements clarified.
