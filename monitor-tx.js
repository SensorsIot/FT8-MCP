// Monitor WSJT-X UDP traffic for TX state
const dgram = require('dgram');

const UDP_PORT = 2237;
const udpSocket = dgram.createSocket('udp4');

let lastTxState = null;

function parseStatusMessage(msg) {
    try {
        let offset = 8; // Skip magic and schema

        // Message type (should be 1 for Status)
        const msgType = msg.readUInt32BE(offset);
        offset += 4;

        if (msgType !== 1) return null;

        // ID (QString - length + UTF-16BE string)
        const idLen = msg.readUInt32BE(offset);
        offset += 4 + idLen;

        // Dial frequency (quint64)
        const dialFreq = Number(msg.readBigUInt64BE(offset));
        offset += 8;

        // Mode (QString)
        const modeLen = msg.readUInt32BE(offset);
        offset += 4;
        const mode = msg.slice(offset, offset + modeLen).toString('utf16le');
        offset += modeLen;

        // DX call (QString)
        const dxCallLen = msg.readUInt32BE(offset);
        offset += 4 + dxCallLen;

        // Report (QString)
        const reportLen = msg.readUInt32BE(offset);
        offset += 4 + reportLen;

        // Tx mode (QString)
        const txModeLen = msg.readUInt32BE(offset);
        offset += 4 + txModeLen;

        // Tx enabled (bool)
        const txEnabled = msg.readUInt8(offset) !== 0;
        offset += 1;

        // Transmitting (bool) - THIS IS WHAT WE WANT!
        const transmitting = msg.readUInt8(offset) !== 0;
        offset += 1;

        // Decoding (bool)
        const decoding = msg.readUInt8(offset) !== 0;
        offset += 1;

        // Rx DF (quint32)
        const rxDF = msg.readUInt32BE(offset);
        offset += 4;

        // Tx DF (quint32)
        const txDF = msg.readUInt32BE(offset);
        offset += 4;

        return {
            dialFreq,
            mode: mode || 'N/A',
            txEnabled,
            transmitting,
            decoding,
            rxDF,
            txDF
        };
    } catch (e) {
        return null;
    }
}

udpSocket.on('message', (msg, rinfo) => {
    const timestamp = new Date().toISOString();

    // Parse magic and type
    if (msg.length >= 12) {
        const magic = msg.readUInt32BE(0);
        const msgType = msg.readUInt32BE(8);

        if (magic === 0xadbccbda) {
            // Only process Status messages (type 1)
            if (msgType === 1) {
                const status = parseStatusMessage(msg);

                if (status) {
                    // Only log when TX state changes or when transmitting
                    if (status.transmitting !== lastTxState || status.transmitting) {
                        console.log(`\n[${timestamp}] STATUS UPDATE`);
                        console.log(`  Frequency: ${status.dialFreq} Hz`);
                        console.log(`  Mode: ${status.mode}`);
                        console.log(`  TX Enabled: ${status.txEnabled}`);
                        console.log(`  >>> TRANSMITTING: ${status.transmitting} <<<`);
                        console.log(`  Decoding: ${status.decoding}`);
                        console.log(`  RX DF: ${status.rxDF} Hz`);
                        console.log(`  TX DF: ${status.txDF} Hz`);

                        if (status.transmitting && !lastTxState) {
                            console.log('\n  *** TX STARTED ***\n');
                        } else if (!status.transmitting && lastTxState) {
                            console.log('\n  *** TX STOPPED ***\n');
                        }

                        lastTxState = status.transmitting;
                    }
                }
            } else if (msgType === 0) {
                // Heartbeat
                console.log(`[${timestamp}] Heartbeat`);
            } else if (msgType === 2) {
                // Decode
                console.log(`[${timestamp}] Decode received`);
            }
        }
    }
});

udpSocket.on('listening', () => {
    const address = udpSocket.address();
    console.log(`[UDP] Monitoring TX state on ${address.address}:${address.port}`);
    console.log('Waiting for WSJT-X to transmit...\n');
});

udpSocket.bind(UDP_PORT);

// Keep alive
setInterval(() => {}, 1000);
