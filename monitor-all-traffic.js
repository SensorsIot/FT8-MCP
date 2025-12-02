// Monitor all traffic between WSJT-X, SliceMaster, and SmartSDR
const dgram = require('dgram');
const net = require('net');

console.log('=== Monitoring WSJT-X <-> SliceMaster <-> SmartSDR Traffic ===\n');

// Monitor UDP port 2237 (WSJT-X protocol)
const udpSocket = dgram.createSocket('udp4');
udpSocket.on('message', (msg, rinfo) => {
    const timestamp = new Date().toISOString();
    const magic = msg.length >= 4 ? msg.readUInt32BE(0) : 0;

    if (magic === 0xadbccbda) {
        const msgType = msg.length >= 12 ? msg.readUInt32BE(8) : -1;
        const types = {
            0: 'Heartbeat', 1: 'Status', 2: 'Decode', 3: 'Clear',
            4: 'Reply', 5: 'QSOLogged', 6: 'Close', 7: 'Replay',
            8: 'HaltTx', 9: 'FreeText', 10: 'WSPRDecode'
        };
        console.log(`[UDP 2237] ${timestamp} ${rinfo.address}:${rinfo.port} -> Type ${msgType} (${types[msgType] || 'Unknown'}) ${msg.length}b`);

        // Show hex for Reply/FreeText messages
        if (msgType === 4 || msgType === 9) {
            console.log(`  HEX: ${msg.toString('hex').substring(0, 200)}...`);
        }
    }
});
udpSocket.bind(2237, () => {
    console.log('[UDP 2237] Listening for WSJT-X protocol messages\n');
});

// Monitor TCP port 4992 (FlexRadio command/control)
const flexServer = net.createServer((socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP 4992] ${new Date().toISOString()} SliceMaster connected from ${clientAddr}\n`);

    socket.on('data', (data) => {
        const timestamp = new Date().toISOString();
        const text = data.toString('ascii').trim();
        console.log(`[TCP 4992 RX] ${timestamp} ${clientAddr}`);
        console.log(`  DATA: ${text}`);
    });

    socket.on('end', () => {
        console.log(`[TCP 4992] ${new Date().toISOString()} ${clientAddr} disconnected\n`);
    });

    socket.on('error', (err) => {
        console.log(`[TCP 4992] ${new Date().toISOString()} Error: ${err.message}`);
    });
});

flexServer.listen(4992, () => {
    console.log('[TCP 4992] Proxy listening for FlexRadio commands (will NOT forward to radio)\n');
});

// Monitor CAT control port 7831 (from WSJT-X INI)
const catServer = net.createServer((socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[CAT 7831] ${new Date().toISOString()} WSJT-X connected from ${clientAddr}\n`);

    socket.on('data', (data) => {
        const timestamp = new Date().toISOString();
        const hex = data.toString('hex');
        const ascii = data.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
        console.log(`[CAT 7831 RX] ${timestamp} ${clientAddr}`);
        console.log(`  HEX: ${hex.substring(0, 200)}${hex.length > 200 ? '...' : ''}`);
        console.log(`  ASCII: ${ascii.substring(0, 100)}${ascii.length > 100 ? '...' : ''}`);
    });

    socket.on('end', () => {
        console.log(`[CAT 7831] ${new Date().toISOString()} ${clientAddr} disconnected\n`);
    });
});

catServer.listen(7831, () => {
    console.log('[CAT 7831] Listening for CAT control commands\n');
});

console.log('Monitoring started. Press Ctrl+C to stop.\n');
console.log('NOTE: This is a passive monitor. It will capture traffic but NOT forward to real devices.\n');
console.log('To see real traffic, you need to:');
console.log('1. Stop SliceMaster');
console.log('2. Run this monitor');
console.log('3. Reconfigure WSJT-X/SliceMaster to point to these ports\n');
console.log('='.repeat(80) + '\n');

// Keep alive
setInterval(() => {}, 1000);
