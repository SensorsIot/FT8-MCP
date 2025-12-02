# Log-Control.md  
How Logging Programs Work with SliceMaster (Log4OM, N1MM, etc.)

This document describes how a **logging program** (e.g. Log4OM, N1MM+, DXLab Log, HRD Logbook) integrates with **SliceMaster 6000** in a multi-slice FlexRadio + WSJT-X environment.

Focus:  
- The logger talks to **SliceMaster**, not directly to WSJT-X, for **rig control and band/mode info**.  
- WSJT-X may still send **UDP / ADIF** to the logger, but that is optional and separate from rig control.

---

## 1. Scope & Assumptions

- FlexRadio running **SmartSDR + DAX**.  
- SliceMaster 6000 is connected to the Flex via **SmartSDR API**.  
- Multiple WSJT-X instances are running, each tied to one slice via HRD TCP and DAX.  
- A logging program (e.g. Log4OM) is running on the same or a reachable host.  

**Assumption for this document:**  
> The **logging program uses SliceMaster for rig control and frequency/mode information**.  
> WSJT-X does **not** talk directly to the logger for rig control (no CAT from WSJT-X to logger).

WSJT-X may still send completed QSOs via UDP/ADIF, but all **radio state** (freq, mode, band) is taken from SliceMaster.

---

## 2. Actors & Links

### 2.1 Actors

- **FlexRadio** – Multi-slice SDR controlled via SmartSDR API + DAX.  
- **SliceMaster** – Middle layer that understands Flex slices and emulates HRD TCP rig(s).  
- **WSJT-X instances** – One per slice, each controlled via HRD TCP from SliceMaster.  
- **Logger** – e.g. Log4OM, N1MM+, DXLab, etc.

### 2.2 Logical Connections

```
WSJT-X #A/B/C/D
       ▲
       │ HRD TCP (per slice)
       ▼
   SliceMaster (HRD Servers for WSJT-X)

Logger (Log4OM / N1MM / etc.)
       ▲
       │ HRD TCP (main rig)
       ▼
   SliceMaster (HRD Server for logger)

SliceMaster ↔ FlexRadio (SmartSDR API + DAX)
```

Logger **never talks to WSJT-X for rig control**.  
It only talks to **SliceMaster**.

---

## 3. Rig Control Flow: Logger ↔ SliceMaster ↔ Flex

### 3.1 Logger Configuration

In the logger (example Log4OM):

- **Rig type**: `Ham Radio Deluxe`  
- **Server**: `SliceMaster_IP:HRD_MAIN_PORT`  

The logger believes it is connected to an HRD server.  
SliceMaster emulates this HRD server and maps its commands to Flex.

### 3.2 Typical commands from logger to SliceMaster

- `get frequency`  
- `get mode`  
- `set frequency <Hz>` (e.g., click on a spot)  
- `set mode <LSB|USB|DIGU|CW|FM>`  

SliceMaster:

1. Receives HRD command from logger  
2. Translates it to **Flex API** calls (change slice frequency/mode, or select TX slice)  
3. Sends back frequency/mode via HRD responses  

The logger always sees the **current radio frequency/mode**, as maintained by SliceMaster.

---

## 4. WSJT-X, SliceMaster, and Logger — Data Flows

### 4.1 WSJT-X rig control

- WSJT-X instances connect to **per-slice HRD ports** on SliceMaster.  
- Each instance controls one Flex slice (tuning, PTT, etc.).  
- SliceMaster maps WSJT-X commands to Flex API.  

Logger does not participate in this path.

### 4.2 Logger rig control

- Logger connects to a **separate HRD port** on SliceMaster (the “main rig” port).  
- When the active slice changes, SliceMaster updates what the “main rig” represents for the logger:
  - Current TX slice  
  - Current active slice for SSB/CW/digital operation  
- Logger always sees the correct **band/mode/frequency** for logging, regardless of which WSJT-X instance is active.

### 4.3 QSO data / logging

There are two possible arrangements:

#### Option A — Logger listens to WSJT-X UDP/ADIF (recommended)
- WSJT-X sends:
  - ADIF records to a file
  - UDP QSO/broadcasts on `localhost:UDP_PORT_X`
- Logger imports new QSOs from WSJT-X:
  - via UDP (most modern loggers support the WSJT-X broadcast protocol)  
  - or by polling the WSJT-X ADIF log file  

**BUT:** frequency/mode used in the log entry is taken from **SliceMaster HRD** (i.e., from the actual Flex slice state), not from WSJT-X’s internal rig state.

#### Option B — Logger only uses manual entries
- Operator presses “Log QSO” in the logger manually.  
- Logger queries SliceMaster for current frequency/mode, and saves the QSO.  

In both cases, **WSJT-X does not provide rig control to the logger**.

---

## 5. Spot and Bandmap Integration

SliceMaster can aggregate spots from:

- WSJT-X decodes (per instance)  
- Skimmer, DX cluster, RBN, etc.

Then it serves a **Telnet cluster-like source** that loggers can connect to:

- Logger’s DX cluster configuration points to SliceMaster Telnet server.  
- All WSJT-X-generated FT8 spots show up in the logger’s bandmap.  

Rig control is still via **HRD**, but **spot data** comes through SliceMaster’s cluster server.

---

## 6. Summary of Responsibilities

### SliceMaster
- Emulates **HRD TCP** for *both* WSJT-X and the logger.  
- Talks to Flex via **SmartSDR API** and manages slices.  
- Decides which slice is the “main rig” for the logger.  
- Optionally aggregates and forwards spots to the logger.

### WSJT-X
- Controls only its **assigned slice** via HRD TCP.  
- Produces QSO data (UDP/ADIF) that can be consumed by logger.  
- Does **not** provide rig control to logger directly in this architecture.

### Logger (Log4OM, N1MM, etc.)
- Connects to SliceMaster as if it were HRD.  
- Reads frequency/mode for logging.  
- May receive spots from SliceMaster’s cluster server.  
- May ingest QSOs from WSJT-X via UDP/ADIF, but rig control stays independent.

---

## 7. Key Design Principle for Future MCP

To reproduce this behavior in a custom MCP:

1. Implement at least **two HRD TCP servers**:  
   - One per slice (for WSJT-X instances)  
   - One “main rig” port (for loggers)

2. Ensure the logger’s HRD connection always reflects:
   - Current TX slice  
   - Correct band/mode/frequency

3. Let WSJT-X send QSOs via UDP/ADIF **directly to the logger**, but keep all **rig control** between logger ↔ MCP ↔ radio.

This keeps the design clean, avoids COM conflicts, and mirrors SliceMaster’s proven behavior.

---

# End of Log-Control.md
