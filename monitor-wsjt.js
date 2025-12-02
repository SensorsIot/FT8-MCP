// Monitor WSJT-X INI file and UDP traffic
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const INI_PATH = path.join(process.env.LOCALAPPDATA, 'WSJT-X - Slice-A', 'WSJT-X - Slice-A.ini');
const UDP_PORT = 2237;

// UDP listener
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
    console.log(`[UDP ERROR] ${err.stack}`);
    udpSocket.close();
});

udpSocket.on('message', (msg, rinfo) => {
    const timestamp = new Date().toISOString();
    console.log(`\n[UDP ${timestamp}] From ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);

    // Parse WSJT-X message header
    if (msg.length >= 8) {
        const magic = msg.readUInt32BE(0);
        const schema = msg.readUInt32BE(4);

        if (magic === 0xadbccbda) {
            const messageType = msg.length >= 12 ? msg.readUInt32BE(8) : -1;
            const typeNames = {
                0: 'Heartbeat',
                1: 'Status',
                2: 'Decode',
                3: 'Clear',
                4: 'Reply',
                5: 'QSOLogged',
                6: 'Close',
                7: 'Replay',
                8: 'HaltTx',
                9: 'FreeText',
                10: 'WSPRDecode',
                11: 'Location',
                12: 'LoggedADIF',
                13: 'HighlightCallsign',
                14: 'SwitchConfiguration',
                15: 'Configure'
            };

            console.log(`  Magic: 0x${magic.toString(16)}, Schema: ${schema}, Type: ${messageType} (${typeNames[messageType] || 'Unknown'})`);
            console.log(`  Hex: ${msg.toString('hex').substring(0, 100)}...`);
        }
    }
});

udpSocket.on('listening', () => {
    const address = udpSocket.address();
    console.log(`[UDP] Listening on ${address.address}:${address.port}`);
});

udpSocket.bind(UDP_PORT);

// INI file watcher
console.log(`[INI] Watching: ${INI_PATH}`);

let lastIniContent = null;
try {
    lastIniContent = fs.readFileSync(INI_PATH, 'utf8');
} catch (e) {
    console.log(`[INI] File not found yet: ${INI_PATH}`);
}

fs.watchFile(INI_PATH, { interval: 500 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
        const timestamp = new Date().toISOString();
        console.log(`\n[INI ${timestamp}] File changed!`);

        try {
            const newContent = fs.readFileSync(INI_PATH, 'utf8');

            if (lastIniContent) {
                // Show what changed
                const oldLines = lastIniContent.split('\n');
                const newLines = newContent.split('\n');

                console.log('  Changes:');
                newLines.forEach((line, i) => {
                    if (oldLines[i] !== line) {
                        console.log(`    OLD: ${oldLines[i] || '(new line)'}`);
                        console.log(`    NEW: ${line}`);
                    }
                });
            }

            lastIniContent = newContent;
        } catch (e) {
            console.log(`  Error reading file: ${e.message}`);
        }
    }
});

console.log('\n=== Monitoring started ===');
console.log('Press Ctrl+C to stop\n');

// Keep alive
setInterval(() => {}, 1000);
