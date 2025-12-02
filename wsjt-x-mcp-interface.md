# WSJT-X MCP Server - AI Interface Guide

**Version:** 1.0.0
**Protocol:** Model Context Protocol (MCP) v2024-11-05
**Last Updated:** 2025-11-27

This guide provides everything an AI agent needs to interact with the WSJT-X MCP Server for autonomous amateur radio operations.

---

## 1. Quick Start

### What This Server Does

The WSJT-X MCP Server enables autonomous control of multi-slice amateur radio operations:
- **4 simultaneous receivers** (FlexRadio slices A-D on different bands)
- **Automatic station decoding** (FT8, FT4, etc.)
- **Autonomous QSO execution** (complete exchanges via state machine)
- **Logbook management** (ADIF format)
- **Rig control** (frequency, mode, TX designation)

### Connection

**Transport:** stdio (stdin/stdout)
**Format:** JSON-RPC 2.0
**Server Name:** `wsjt-x-mcp`

The MCP SDK handles all protocol details automatically. You interact via tools and resources.

### First Steps

1. **Health check:** Call `mcp_ping()` to verify server is online
2. **Get state:** Call `rig_get_state()` to see all channels
3. **Get decodes:** Call `wsjtx_get_decodes()` to see stations
4. **Execute QSO:** Call `execute_qso()` to start autonomous contact

---

## 2. System Overview

### Operating Modes

- **FLEX Mode** (typical): 4 slices on FlexRadio, auto-managed WSJT-X instances
- **STANDARD Mode** (rare): Manual instance management, single rig

### Channel Layout (FLEX Mode)

```
Channel A (Slice 0) → 10m (28.074 MHz) FT8 → WSJT-X Instance "Slice-A"
Channel B (Slice 1) → 15m (21.074 MHz) FT8 → WSJT-X Instance "Slice-B"
Channel C (Slice 2) → 20m (14.074 MHz) FT8 → WSJT-X Instance "Slice-C"
Channel D (Slice 3) → 40m (7.074 MHz) FT8 → WSJT-X Instance "Slice-D"
```

**One channel at a time can transmit** - designated by TX channel setting.

### User Station

- **Callsign:** HB9BLA
- **Grid:** JN37VL

---

## 3. MCP Tools Reference

### 3.1 Health & Status

#### `mcp_ping()`
Verify server is responding and get status.

**Parameters:** None

**Returns:**
```json
{
  "server": "online",
  "mode": "FLEX",
  "wsjtxInstances": 4,
  "flexConnected": true,
  "timestamp": "2025-11-27T17:30:00.000Z"
}
```

#### `rig_get_state()`
Get complete system state including all channels.

**Parameters:** None

**Returns:**
```json
{
  "channels": [
    {
      "id": "A",
      "index": 0,
      "freq_hz": 28074000,
      "band": "10m",
      "mode": "FT8",
      "is_tx": true,
      "status": "decoding",
      "connected": true,
      "last_decode_time": "2025-11-27T17:30:15Z"
    }
    // ... channels B, C, D
  ],
  "tx_channel": "A",
  "flex_connected": true
}
```

### 3.2 Getting Decoded Stations

#### `wsjtx_get_decodes()`
Get recent decoded stations from all channels.

**Parameters:** None

**Returns:** Array of decode objects
```json
[
  {
    "channel": "C",
    "callsign": "EA4IFI",
    "grid": "IM79",
    "snr": 16,
    "frequency": 1234,
    "message": "CQ EA4IFI IM79",
    "is_cq": true,
    "band": "20m",
    "mode": "FT8",
    "timestamp": "2025-11-27T17:30:15Z"
  }
]
```

**Key Fields:**
- `is_cq`: true if station is calling CQ
- `snr`: Signal-to-noise ratio in dB (higher is better)
- `channel`: Which channel decoded this ("A", "B", "C", "D")
- `grid`: Maidenhead grid square

### 3.3 Executing QSOs

#### `execute_qso(instanceId, targetCallsign, myCallsign, myGrid)`
Start autonomous QSO with target station. The state machine handles the complete exchange.

**Parameters:**
- `instanceId` (string): Instance name, format "Slice-{channel}" (e.g., "Slice-C")
- `targetCallsign` (string): Target station callsign (e.g., "EA4IFI")
- `myCallsign` (string): Your callsign (typically "HB9BLA")
- `myGrid` (string): Your grid locator (typically "JN37VL")

**Example:**
```typescript
execute_qso("Slice-C", "EA4IFI", "HB9BLA", "JN37VL")
```

**Returns:** `"Started autonomous QSO with EA4IFI"`

**What Happens:**
1. State machine calls target station
2. Exchanges signal reports
3. Sends 73 to complete
4. Logs QSO to ADIF automatically

**Important:** Only one QSO per instance at a time. Wait for completion before starting another.

### 3.4 Logbook Management

#### `log_get_worked(callsign, band, mode)`
Check if you've worked a station on a specific band/mode.

**Parameters:**
- `callsign` (string): Station callsign
- `band` (string): Band (e.g., "20m", "40m")
- `mode` (string): Mode (e.g., "FT8")

**Returns:**
```json
{"worked": false}
```
or
```json
{
  "worked": true,
  "qso_date": "2025-11-26",
  "qso_time": "1430",
  "band": "20m",
  "mode": "FT8"
}
```

**Usage:** Always check before calling to avoid duplicates.

#### `log_get_info(callsign)`
Get all QSOs with a specific callsign.

**Parameters:**
- `callsign` (string): Station callsign

**Returns:** Array of QSO records

#### `log_export(output_path)`
Export logbook to ADIF file.

**Parameters:**
- `output_path` (string): Full path for output file

**Example:**
```typescript
log_export("C:\\Users\\HB9BL\\Desktop\\my_qsos.adi")
```

### 3.5 Rig Control

#### `rig_tune_slice(slice_index, freq_hz)`
Tune a slice to a specific frequency.

**Parameters:**
- `slice_index` (number): 0-3 (A=0, B=1, C=2, D=3)
- `freq_hz` (number): Frequency in Hz (e.g., 14074000)

**Example:**
```typescript
rig_tune_slice(2, 14074000)  // Tune slice C to 20m FT8
```

#### `rig_set_slice_mode(slice_index, mode)`
Set the mode for a slice.

**Parameters:**
- `slice_index` (number): 0-3
- `mode` (string): "DIGU", "USB", "LSB", "CW", etc.

#### `rig_set_tx_channel(channel_index)`
Designate which channel transmits.

**Parameters:**
- `channel_index` (number): 0-3

**Example:**
```typescript
rig_set_tx_channel(2)  // Set channel C as TX
```

**Important:** Only one channel can TX at a time.

#### `rig_emergency_stop()`
Emergency TX stop - disables transmit on all slices immediately.

**Parameters:** None

**Use:** Safety measure for immediate TX halt.

### 3.6 WSJT-X Control

#### `wsjtx_configure(instanceId, option, value)`
Configure WSJT-X instance settings.

**Parameters:**
- `instanceId` (string): Instance name (e.g., "Slice-C")
- `option` (string): Setting name
- `value` (string): Setting value

#### `wsjtx_halt_tx(instanceId)`
Stop transmitting on specific instance.

**Parameters:**
- `instanceId` (string): Instance name

#### `wsjtx_clear_decodes(instanceId)`
Clear decode history for instance.

**Parameters:**
- `instanceId` (string): Instance name

---

## 4. MCP Resources Reference

Resources are read-only data sources. Use `resources/read` to access them.

### `wsjt-x://state`
Complete system state (channels + logbook + instances).

**Format:** JSON

### `wsjt-x://channels`
Channel list with current state of all slices.

**Format:** JSON

### `wsjt-x://decodes`
Recent decodes from all channels (same as `wsjtx_get_decodes()` tool).

**Format:** JSON

### `wsjt-x://instances`
List of WSJT-X instances (legacy - use channels instead).

**Format:** JSON

### `wsjt-x://logbook`
Logbook statistics and path information.

**Format:** JSON

---

## 5. Common Workflows

### Workflow 1: Work Strongest CQ Station

```typescript
// Step 1: Get all decoded stations
const decodes = wsjtx_get_decodes();

// Step 2: Filter for CQ stations only
const cqStations = decodes.filter(d => d.is_cq);

// Step 3: Sort by SNR (strongest first)
cqStations.sort((a, b) => b.snr - a.snr);

// Step 4: Work the strongest
if (cqStations.length > 0) {
  const best = cqStations[0];
  execute_qso(
    `Slice-${best.channel}`,
    best.callsign,
    "HB9BLA",
    "JN37VL"
  );
}
```

### Workflow 2: Work New Stations Only

```typescript
// Get all CQ stations
const decodes = wsjtx_get_decodes();
const cqStations = decodes.filter(d => d.is_cq);

// Filter for new (not worked) stations
const newStations = [];
for (const station of cqStations) {
  const result = log_get_worked(station.callsign, station.band, station.mode);
  if (!result.worked) {
    newStations.push(station);
  }
}

// Work strongest new station
if (newStations.length > 0) {
  newStations.sort((a, b) => b.snr - a.snr);
  const best = newStations[0];

  execute_qso(
    `Slice-${best.channel}`,
    best.callsign,
    "HB9BLA",
    "JN37VL"
  );
}
```

### Workflow 3: Work Specific Band

```typescript
// Get decodes from 20m only
const decodes = wsjtx_get_decodes();
const on20m = decodes.filter(d => d.band === "20m" && d.is_cq);

// Work strongest on 20m
if (on20m.length > 0) {
  on20m.sort((a, b) => b.snr - a.snr);
  const best = on20m[0];

  execute_qso("Slice-C", best.callsign, "HB9BLA", "JN37VL");
}
```

### Workflow 4: Prioritize by SNR Threshold

```typescript
// Get only strong signals (SNR > 0 dB)
const decodes = wsjtx_get_decodes();
const strongSignals = decodes.filter(d => d.is_cq && d.snr > 0);

if (strongSignals.length > 0) {
  strongSignals.sort((a, b) => b.snr - a.snr);
  const best = strongSignals[0];

  execute_qso(
    `Slice-${best.channel}`,
    best.callsign,
    "HB9BLA",
    "JN37VL"
  );
}
```

### Workflow 5: Multi-Band Hunt

```typescript
// Get all CQ stations across all bands
const decodes = wsjtx_get_decodes();
const allCQ = decodes.filter(d => d.is_cq);

// Find best new station on any band
const newStations = [];
for (const station of allCQ) {
  const worked = log_get_worked(station.callsign, station.band, station.mode);
  if (!worked.worked) {
    newStations.push(station);
  }
}

// Sort by SNR, work the best
if (newStations.length > 0) {
  newStations.sort((a, b) => b.snr - a.snr);
  const best = newStations[0];

  console.log(`Working ${best.callsign} (${best.grid}) on ${best.band} - SNR ${best.snr}dB`);

  execute_qso(
    `Slice-${best.channel}`,
    best.callsign,
    "HB9BLA",
    "JN37VL"
  );
}
```

---

## 6. Error Handling

### Common Errors

**Error:** `"Flex not connected"`
**Solution:** Check `rig_get_state()` first, verify `flex_connected: true`

**Error:** `"Instance not found"`
**Solution:** Use correct instanceId format: "Slice-A", "Slice-B", "Slice-C", "Slice-D"

**Error:** `"Instance already in QSO"`
**Solution:** One QSO per instance at a time. Wait for current QSO to complete.

**Error:** `"Invalid frequency"`
**Solution:** Use Hz (14074000, not 14.074)

**Error:** `"Manual start_instance is only available in STANDARD mode"`
**Solution:** In FLEX mode, instances are auto-managed. Don't call `start_instance()`.

### Validation Checklist

Before calling `execute_qso()`:
1. ✅ Verify station is calling CQ (`is_cq: true`)
2. ✅ Check not already worked (`log_get_worked()` returns `worked: false`)
3. ✅ Verify good signal (SNR > -15 dB recommended)
4. ✅ Use correct instanceId format (`Slice-{channel}`)
5. ✅ Ensure instance not already in QSO

---

## 7. Data Formats Reference

### Decode Object
```json
{
  "channel": "C",           // A, B, C, or D
  "callsign": "EA4IFI",     // Station callsign
  "grid": "IM79",           // Maidenhead grid square
  "snr": 16,                // Signal-to-noise ratio (dB)
  "frequency": 1234,        // Audio frequency (Hz, within passband)
  "message": "CQ EA4IFI IM79",  // Full decoded message
  "is_cq": true,            // true if calling CQ
  "band": "20m",            // Ham radio band
  "mode": "FT8",            // Digital mode
  "timestamp": "2025-11-27T17:30:15Z"  // ISO 8601 timestamp
}
```

### Channel Object
```json
{
  "id": "A",                // A, B, C, or D
  "index": 0,               // 0, 1, 2, or 3
  "freq_hz": 28074000,      // Frequency in Hz
  "band": "10m",            // Ham radio band
  "mode": "FT8",            // Operating mode
  "is_tx": true,            // true if this channel can transmit
  "status": "decoding",     // Current status
  "connected": true,        // true if WSJT-X instance connected
  "last_decode_time": "2025-11-27T17:30:15Z"  // Last decode timestamp
}
```

### QSO Record Object
```json
{
  "callsign": "EA4IFI",
  "grid": "IM79",
  "band": "20m",
  "mode": "FT8",
  "qso_date": "2025-11-27",
  "qso_time": "1730",
  "tx_power": "100",
  "rst_sent": "+05",
  "rst_rcvd": "+16"
}
```

---

## 8. Best Practices

### DO

✅ **Check server status** with `mcp_ping()` before operations
✅ **Validate station not worked** before calling
✅ **Filter by SNR** to prioritize good signals
✅ **Use correct instanceId format** ("Slice-A", not "A" or "slice-a")
✅ **Wait for QSO completion** before starting another on same instance
✅ **Handle errors gracefully** with try-catch and fallback logic

### DON'T

❌ **Don't call worked stations** - check logbook first
❌ **Don't start multiple QSOs** on same instance simultaneously
❌ **Don't use frequencies in MHz** - always use Hz
❌ **Don't ignore SNR** - weak signals (-20 dB) often fail
❌ **Don't call `start_instance()` in FLEX mode** - instances are auto-managed

### Performance Tips

- **Batch logbook checks** to minimize tool calls
- **Sort by SNR descending** to work strongest stations first
- **Set SNR threshold** (-10 dB minimum recommended for FT8)
- **Prioritize new grids** for award progress
- **Monitor all 4 bands** simultaneously for best opportunities

---

## 9. Quick Reference

### Essential Tools
```typescript
mcp_ping()                                      // Health check
rig_get_state()                                 // Get all channels
wsjtx_get_decodes()                             // Get decoded stations
log_get_worked(call, band, mode)                // Check if worked
execute_qso(instance, call, mycall, mygrid)     // Execute QSO
rig_emergency_stop()                            // Emergency TX halt
```

### Instance Names
```
Slice-A  →  Channel A  →  10m
Slice-B  →  Channel B  →  15m
Slice-C  →  Channel C  →  20m
Slice-D  →  Channel D  →  40m
```

### Common Frequencies
```
28.074 MHz  →  10m FT8
21.074 MHz  →  15m FT8
14.074 MHz  →  20m FT8
7.074 MHz   →  40m FT8
```

### User Station Info
```
Callsign: HB9BLA
Grid:     JN37VL
```

---

## 10. Example: Complete Autonomous Session

```typescript
// 1. Health check
const health = mcp_ping();
console.log(`Server: ${health.server}, Mode: ${health.mode}`);

// 2. Get system state
const state = rig_get_state();
console.log(`TX Channel: ${state.tx_channel}, Flex: ${state.flex_connected}`);

// 3. Get decoded stations
const decodes = wsjtx_get_decodes();
console.log(`${decodes.length} stations decoded`);

// 4. Find new CQ stations
const cqStations = decodes.filter(d => d.is_cq && d.snr > -10);
const newStations = [];

for (const station of cqStations) {
  const worked = log_get_worked(station.callsign, station.band, station.mode);
  if (!worked.worked) {
    newStations.push(station);
  }
}

console.log(`${newStations.length} new stations available`);

// 5. Work strongest new station
if (newStations.length > 0) {
  newStations.sort((a, b) => b.snr - a.snr);
  const best = newStations[0];

  console.log(`Working ${best.callsign} (${best.grid}) on ${best.band}`);
  console.log(`SNR: ${best.snr}dB, Message: "${best.message}"`);

  const result = execute_qso(
    `Slice-${best.channel}`,
    best.callsign,
    "HB9BLA",
    "JN37VL"
  );

  console.log(result);
}
```

---

## 11. Troubleshooting

### No Stations Decoded

**Check:**
1. Is Flex connected? (`rig_get_state()` → `flex_connected: true`)
2. Are WSJT-X instances running? (`mcp_ping()` → `wsjtxInstances: 4`)
3. Are channels on correct frequencies? (Check `rig_get_state().channels`)

### QSO Won't Start

**Check:**
1. Correct instanceId format? (Must be "Slice-A", "Slice-B", "Slice-C", or "Slice-D")
2. Instance already in QSO? (One QSO per instance at a time)
3. Station still calling CQ? (Decodes are time-limited)

### Can't Transmit

**Check:**
1. Is TX channel set? (`rig_get_state()` → `tx_channel` should not be null)
2. Emergency stop active? (Call `rig_emergency_stop()` then re-enable TX)

---

## 12. Support

For detailed technical documentation, see:
- **MCP-fsd.v3.md** - Complete functional specification
- **CLAUDE.md** - Build and development instructions

**MCP Server Version:** 1.0.0
**Protocol Version:** MCP v2024-11-05
**Last Updated:** 2025-11-27
