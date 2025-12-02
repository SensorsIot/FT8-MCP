/**
 * Test script to send ADIF format QSO to Log4OM
 * This matches the new UdpRebroadcaster implementation
 */

const dgram = require('dgram');

// Configuration (from config.json)
const CONFIG = {
    port: 2236,  // Log4OM GT_LOG port for ADIF messages
    host: '127.0.0.1',
};

/**
 * Format an ADIF field: <FIELDNAME:LENGTH>VALUE
 */
function adifField(fieldName, value) {
    const length = Buffer.byteLength(value, 'utf8');
    return `<${fieldName}:${length}>${value}`;
}

/**
 * Format date as YYYYMMDD for ADIF
 */
function formatAdifDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

/**
 * Format time as HHMMSS for ADIF
 */
function formatAdifTime(date) {
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hours}${minutes}${seconds}`;
}

/**
 * Encode a QSO record to ADIF format
 */
function encodeAdifMessage(qso) {
    const fields = [];

    // Required fields
    if (qso.call) {
        fields.push(adifField('CALL', qso.call));
    }

    if (qso.mode) {
        fields.push(adifField('MODE', qso.mode));
    }

    if (qso.band) {
        fields.push(adifField('BAND', qso.band));
    }

    // Frequency in MHz
    if (qso.freq_hz) {
        const freqMhz = (qso.freq_hz / 1000000).toFixed(6);
        fields.push(adifField('FREQ', freqMhz));
    }

    // Timestamps
    if (qso.timestamp_start) {
        const startDate = new Date(qso.timestamp_start);
        fields.push(adifField('QSO_DATE', formatAdifDate(startDate)));
        fields.push(adifField('TIME_ON', formatAdifTime(startDate)));
    }

    if (qso.timestamp_end) {
        const endDate = new Date(qso.timestamp_end);
        fields.push(adifField('TIME_OFF', formatAdifTime(endDate)));
    }

    // Optional fields
    if (qso.grid) {
        fields.push(adifField('GRIDSQUARE', qso.grid));
    }

    if (qso.rst_sent) {
        fields.push(adifField('RST_SENT', qso.rst_sent));
    }

    if (qso.rst_recv) {
        fields.push(adifField('RST_RCVD', qso.rst_recv));
    }

    if (qso.tx_power_w) {
        fields.push(adifField('TX_PWR', qso.tx_power_w.toString()));
    }

    if (qso.notes) {
        fields.push(adifField('COMMENT', qso.notes));
    }

    // End of record
    fields.push('<EOR>');

    return fields.join(' ');
}

// Create a fake QSO record for testing
const now = new Date();
const fakeQso = {
    call: 'DL5XYZ',
    grid: 'JO62',
    freq_hz: 14074000,  // 20m FT8
    band: '20m',
    mode: 'FT8',
    rst_sent: '-10',
    rst_recv: '-05',
    tx_power_w: 100,
    notes: 'TEST ADIF QSO from MCP',
    timestamp_start: new Date(now.getTime() - 90000).toISOString(),  // 90 seconds ago
    timestamp_end: now.toISOString(),
};

console.log('=== Log4OM ADIF Test ===');
console.log('Sending fake QSO:');
console.log(JSON.stringify(fakeQso, null, 2));
console.log('');

console.log(`Target: ${CONFIG.host}:${CONFIG.port}`);
console.log('');

// Create UDP socket
const socket = dgram.createSocket('udp4');

// Encode the message
const adifMessage = encodeAdifMessage(fakeQso);
console.log('ADIF message:');
console.log(adifMessage);
console.log('');

const buffer = Buffer.from(adifMessage, 'utf8');
console.log(`Message size: ${buffer.length} bytes`);
console.log('');

// Send the message
socket.send(buffer, CONFIG.port, CONFIG.host, (err) => {
    if (err) {
        console.error('❌ Error sending message:', err);
    } else {
        console.log('✅ ADIF message sent successfully!');
        console.log('');
        console.log('Check Log4OM for a new QSO entry:');
        console.log(`  Call: ${fakeQso.call}`);
        console.log(`  Grid: ${fakeQso.grid}`);
        console.log(`  Band: ${fakeQso.band}`);
        console.log(`  Mode: ${fakeQso.mode}`);
        console.log(`  RST Sent: ${fakeQso.rst_sent}`);
        console.log(`  RST Recv: ${fakeQso.rst_recv}`);
        console.log('');
        console.log('IMPORTANT: Make sure Log4OM is configured with:');
        console.log(`  UDP Port: ${CONFIG.port}`);
        console.log('  Message Type: ADIF_MESSAGE (not JT_MESSAGE)');
    }
    socket.close();
});
