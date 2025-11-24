# WSJT-X MCP Server - Deployment & Testing Guide

## Target System: 10.99.6.171

### Prerequisites
1. **Node.js 18+** installed on 10.99.6.171
2. **WSJT-X** installed (default path: `C:\WSJT\wsjtx\bin\wsjtx.exe`)
3. **Git** for cloning the repository
4. **FlexRadio** (optional, for FLEX mode testing)

---

## Deployment Steps

### 1. Clone Repository on Target System
```powershell
# SSH or RDP into 10.99.6.171
cd C:\
git clone https://github.com/SensorsIot/wsjt-x-MCP.git
cd wsjt-x-MCP
```

### 2. Install Dependencies
```powershell
npm install
cd frontend
npm install
cd ..
```

### 3. Build Frontend
```powershell
cd frontend
npm run build
cd ..
```

### 4. Configure Operation Mode

**For Standard Mode (IC-7300):**
```powershell
# No configuration needed - defaults to STANDARD mode
```

**For FlexRadio Mode:**
```powershell
$env:WSJTX_MODE = "FLEX"
$env:FLEX_HOST = "10.99.6.171"  # FlexRadio IP
```

---

## Testing Scenarios

### Test 1: Standard Mode - Basic Startup
```powershell
# Start the server
npm start
```

**Expected Output:**
```
Starting WSJT-X MCP Server...
Operation Mode: STANDARD
Starting WSJT-X Manager in STANDARD mode.
Starting WSJT-X instance: IC-7300
WSJT-X UDP listener started on port 2237
MCP Server started on stdio
Web Dashboard started on http://localhost:3000
```

**Verify:**
- WSJT-X instance launches automatically
- Web Dashboard accessible at `http://10.99.6.171:3000`
- MCP server ready for AI agent connection

### Test 2: FlexRadio Mode - Slice Detection
```powershell
$env:WSJTX_MODE = "FLEX"
npm start
```

**Expected Output:**
```
Starting WSJT-X MCP Server...
Operation Mode: FLEX
Connecting to FlexRadio at 10.99.6.171:4992...
FlexRadio connected
Slice slice_0 activated: 14074000 Hz, DIGU
Auto-launching WSJT-X for slice slice_0: Slice_14.074MHz
```

**Verify:**
- FlexRadio connection established
- WSJT-X instances auto-launch for digital slices
- Slice-to-instance mapping works

### Test 3: UDP Communication
**Prerequisites:** WSJT-X running and decoding

**Monitor console output:**
```
[IC-7300] Heartbeat
[IC-7300] Status: FT8 @ 14074000 Hz
[IC-7300] Decode: CQ DX W1ABC FN42 (SNR: -5)
```

**Verify:**
- Heartbeat messages every 15 seconds
- Status updates on frequency/mode changes
- Decode messages appear in real-time

### Test 4: Autonomous QSO (via MCP)
**Connect AI agent (e.g., Claude Desktop) to MCP server**

**MCP Tool Call:**
```json
{
  "tool": "execute_qso",
  "arguments": {
    "instanceId": "IC-7300",
    "targetCallsign": "W1ABC",
    "myCallsign": "K2XYZ",
    "myGrid": "FN20"
  }
}
```

**Expected Console Output:**
```
Starting QSO with W1ABC
[QSO] State: IDLE -> CALLING_CQ
[QSO] Sending: CQ K2XYZ FN20
[QSO] State: CALLING_CQ -> WAITING_REPLY
[IC-7300] Decode: K2XYZ W1ABC FN42
[QSO] State: WAITING_REPLY -> SENDING_REPORT
[QSO] Sending: W1ABC K2XYZ -05
...
[QSO] QSO complete with W1ABC
```

**Verify:**
- QSO state machine progresses through states
- Messages sent to WSJT-X
- QSO completes or times out appropriately

### Test 5: Web Dashboard
**Open browser:** `http://10.99.6.171:3000`

**Verify:**
- Instance list displays
- Connection status shows "Connected"
- Real-time updates via WebSocket

---

## Troubleshooting

### WSJT-X Not Launching
**Issue:** Process spawn fails

**Solution:**
```powershell
# Verify WSJT-X path
Test-Path "C:\WSJT\wsjtx\bin\wsjtx.exe"

# Update path in src/wsjtx/ProcessManager.ts if different
```

### FlexRadio Connection Fails
**Issue:** Cannot connect to 10.99.6.171:4992

**Solution:**
```powershell
# Test TCP connection
Test-NetConnection -ComputerName 10.99.6.171 -Port 4992

# Verify FlexRadio SmartSDR is running
# Check firewall rules
```

### UDP Messages Not Received
**Issue:** No decodes/status in console

**Solution:**
- Verify WSJT-X UDP server is enabled (Settings → Reporting)
- Check UDP port 2237 is not blocked
- Ensure WSJT-X is actually decoding signals

### MCP Connection Issues
**Issue:** AI agent cannot connect

**Solution:**
- Verify stdio transport is working
- Check MCP server logs
- Test with simple MCP tool call

---

## Performance Monitoring

### CPU/Memory Usage
```powershell
# Monitor Node.js process
Get-Process node | Select-Object CPU, WorkingSet
```

### Network Traffic
```powershell
# Monitor UDP traffic on port 2237
netstat -an | findstr "2237"
```

### Log Files
```powershell
# Redirect console output to file
npm start > server.log 2>&1
```

---

## Remote Testing from Development Machine

### SSH Tunnel for Web Dashboard
```powershell
# From your dev machine
ssh -L 3000:localhost:3000 user@10.99.6.171
# Access at http://localhost:3000
```

### Remote MCP Connection
```powershell
# Configure Claude Desktop to connect via SSH
# Update MCP settings to use remote stdio
```

---

## Next Steps After Testing

1. **Verify all test scenarios pass**
2. **Document any issues or edge cases**
3. **Performance tuning if needed**
4. **Production deployment considerations**

---

## Quick Test Commands

```powershell
# Full test sequence
cd C:\wsjt-x-MCP
npm start

# In another terminal, monitor logs
Get-Content server.log -Wait

# Open browser
Start-Process "http://10.99.6.171:3000"
```
