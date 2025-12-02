# Rig Control.md  
Full Rig-Control Reference for MCP / SliceMaster Workflow (Flex + WSJT‑X + HRD)

This document describes the **complete rig-control architecture**, **flows**, and **interactions** between:

- WSJT‑X  
- SliceMaster‑like MCP  
- HRD TCP rig interface  
- Flex SmartSDR API  
- Multi-slice environments  

It is designed as a reference for building a new MCP with behavior equivalent or superior to SliceMaster 6000.

---

# 1. Architecture Overview

```
WSJT-X / JTDX / N1MM / Loggers
             ▲
             │ HRD TCP (per slice)
             ▼
      MCP Rig-Control Core (HRD Server)
             │
      ┌──────┴────────────┬──────────┐
      │ Flex API Backend   │ Hamlib   │
      │ (Slices A–F)       │ Backend  │
      └───────────▲────────┘          │
                  │ Flex TCP          │
                  ▼                   ▼
            FlexRadio SDR         Standard Radios
            SmartSDR API          (e.g. IC-7300)
```

---

# 2. Rig-Control Concepts

## 2.1 Channels vs Slices
To support both Flex and traditional radios, the MCP abstracts radio receivers as **channels**.

- **Flex** → channel = slice (A–F)
- **IC‑7300** → channel = VFO A
- **Dual-VFO radios** → channel A/B
- **WSJT‑X instance** maps to exactly **one** channel

This keeps the MCP interface consistent regardless of hardware.

---

# 3. HRD TCP Protocol Role

WSJT‑X does **not** talk directly to SmartSDR CAT in this mode.  
Instead, WSJT‑X uses:

```
Rig: Ham Radio Deluxe
Network Server: MCP_IP:PORT
```

The MCP implements HRD TCP and translates commands such as:

- `set frequency <Hz>`
- `get frequency`
- `set mode <X>`
- `set ptt on/off`

into **Flex API** or **Hamlib** operations.

### Why HRD?
- Stable, simple TCP protocol  
- Universal support in WSJT‑X, JTDX, N1MM, Log4OM, etc.  
- SliceMaster uses the same architecture  
- Allows full multi-slice control  

---

# 4. WSJT‑X Multi‑Instance Handling

Each WSJT-X instance is launched with its own rig-name:

```
wsjtx.exe --rig-name=Slice-A
```

WSJT‑X then stores settings here:

```
C:\Users\<user>\AppData\Local\WSJT-X - Slice-A\WSJT-X - Slice-A.ini
```

SliceMaster/MCP clones the default WSJT-X configuration into four (or more) rig-named folders and patches:

- Rig = Ham Radio Deluxe  
- Network Server = HRD port per slice  
- Audio input = corresponding DAX RX  
- Audio output = DAX TX  
- UDPServerPort = unique per slice  

---

# 5. Complete Rig-Control Flows

## 5.1 Flow A — **User changes band in WSJT‑X**

```
User changes frequency in WSJT-X
           │
           ▼
WSJT-X sends HRD command:
   "set frequency <Hz>"
           │
           ▼
MCP HRD server receives command (slice-specific)
           │
           ▼
MCP Flex Backend → SmartSDR API:
   slice.set_frequency(Hz)
           │
           ▼
SmartSDR updates slice state
           │
           ▼
SmartSDR notifies MCP via Flex API events
           │
           ▼
WSJT-X polling:
   "get frequency"
MCP replies with new freq
           │
           ▼
WSJT-X updates UI + band
```

### Result:
Band in WSJT‑X = Band of the Flex slice.

---

## 5.2 Flow B — **User tunes the Flex radio first**

```
User tunes slice in SmartSDR
           │
           ▼
SmartSDR API event → MCP receives "slice freq changed"
           │
           ▼
MCP updates HRD state
           │
           ▼
WSJT-X periodically polls HRD:
   "get frequency"
           │
           ▼
WSJT-X updates UI and dial to match Flex
```

This is how SliceMaster ensures **two-way synchronization**.

---

## 5.3 Flow C — **PTT Control Flow**

### When WSJT‑X transmits:

```
WSJT-X → HRD: "set ptt on"
MCP → Flex API: slice.tx = true
Flex radio transmits
SmartSDR API event → MCP updates state
WSJT-X queries → sees TX active
```

### When transmission ends:

```
WSJT-X → HRD: "set ptt off"
MCP → Flex API: slice.tx = false
SmartSDR event → MCP updates
WSJT-X polls → sees RX state
```

### Optional MCP features:
- TX guard (block TX on wrong band/antenna)
- TX follow (auto-select right slice before PTT)

---

## 5.4 Flow D — **Mode Changes**

WSJT‑X sends:

```
set mode DIGU
```

MCP translates:

```
FlexAPI: slice.set_mode("DIGU")
```

SmartSDR updates.

WSJT-X polls for confirmation and updates its GUI.

---

## 5.5 Flow E — **Split Operation**

WSJT‑X may request split using HRD semantics.

MCP handles:

- Setting TX slice  
- Adjusting RX/TX frequencies  
- SmartSDR split logic

Flex handles split very cleanly so HRD → Flex translation is trivial.

---

# 6. MCP Tool API (LLM Facing)

These tools hide internal backend complexity.

### `rig_get_state()`
Returns all channels, freq, mode, TX, DAX.

### `rig_tune_channel(index, freq_hz)`
Moves channel to new freq; updates HRD clients and Flex/Hamlib.

### `rig_set_mode(index, mode)`
DIGU, USB, LSB, CW etc.

### `rig_set_tx_channel(index)`
Choose TX slice.

### `rig_emergency_stop()`
Force PTT off, inhibit TX.

### `wsjtx_get_decodes(instance)`
Returns recent decodes via UDP.

This abstracts Flex or IC‑7300 into one interface.

---

# 7. Mapping Backends

| Backend | Used For | WSJT‑X Rig Setting | Notes |
|--------|----------|---------------------|-------|
| **flex_hrd** | Flex multi-slice | Ham Radio Deluxe | Best all-in-one mode |
| **flex_slice** | WSJT-X Flex rig | Flex Slice A-F | No HRD needed |
| **flex_udp** | Full MCP-driven | None | Advanced AI mode |
| **hamlib_cat** | IC-7300, TS-590 | IC-7300 / Hamlib | Standard CAT radios |
| **ts2000_cat** | Legacy | TS-2000 | Optional fallback |

---

# 8. Summary

- HRD TCP is the ideal universal rig protocol for WSJT-X + Flex + loggers.  
- MCP sits between WSJT-X and FlexRadio.  
- Every slice gets its own WSJT-X instance + config folder + HRD port.  
- MCP translates HRD commands → Flex API.  
- Both directions stay synchronized.  
- Architecture works for Flex and standard radios (via Hamlib).  

This document defines the full rig-control logic required to build a SliceMaster-like MCP with reliable multi-slice digital-mode support.

---

# End of Rig Control.md
