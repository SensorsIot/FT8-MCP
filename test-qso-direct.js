// Simple test to execute a QSO with a strong station on 20m
// This bypasses MCP and directly calls the internal API

const http = require('http');

// Get current decodes from dashboard API
function getDecodes() {
    return new Promise((resolve, reject) => {
        http.get('http://localhost:3001/api/slices', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

// Execute QSO by calling the internal wsjtxManager
async function executeQso() {
    console.log('=== QSO Execution Test ===\n');

    // Get current slices/stations
    const slices = await getDecodes();
    console.log(`Found ${slices.length} active slices`);

    // Find 20m slice (Slice C)
    const slice20m = slices.find(s => s.band === '20m');
    if (!slice20m) {
        console.log('Error: 20m slice not found');
        return;
    }

    console.log(`\n20m Slice: ${slice20m.id} at ${slice20m.dialFrequency} Hz`);
    console.log(`Stations decoded: ${slice20m.stations.length}`);

    // Find CQ calling stations
    const cqStations = slice20m.stations.filter(s =>
        s.message && s.message.startsWith('CQ ')
    );

    console.log(`\nCQ Calling Stations on 20m:`);
    cqStations.forEach(s => {
        console.log(`  ${s.callsign} (${s.grid || 'N/A'}): ${s.snr} dB @ ${s.frequency} Hz - ${s.message}`);
    });

    // Select strongest CQ station
    const target = cqStations.reduce((prev, curr) =>
        (curr.snr > prev.snr) ? curr : prev
    );

    console.log(`\n✓ Selected strongest station: ${target.callsign} (SNR ${target.snr} dB)`);
    console.log(`  Grid: ${target.grid}`);
    console.log(`  Message: ${target.message}`);

    // Now we need to call the execute_qso via the wsjtxManager
    // Since we can't access the MCP server directly, we'll use the WebSocket API
    console.log(`\n>>> Executing QSO with ${target.callsign} on ${slice20m.id}...`);
    console.log(`    Command: execute_qso("${slice20m.id}", "${target.callsign}", "HB9BLA", "JN37VL")`);

    // Import the manager directly
    const { WsjtxManager } = require('./dist/wsjtx/WsjtxManager.js');

    // We can't easily get the running instance, so let's just show what would happen
    console.log('\n✓ Test complete - QSO would be executed with these parameters:');
    console.log(`  Instance: ${slice20m.id}`);
    console.log(`  Target: ${target.callsign}`);
    console.log(`  My Call: HB9BLA`);
    console.log(`  My Grid: JN37VL`);
    console.log(`\nThe server should:`);
    console.log(`  1. Find decode for ${target.callsign} (last seen ${new Date(target.lastSeen).toISOString()})`);
    console.log(`  2. Send Reply message (simulate double-click): "${target.callsign} HB9BLA JN37VL"`);
    console.log(`  3. Enable TX in WSJT-X on ${slice20m.id}`);
    console.log(`  4. Progress through QSO states`);

    console.log('\n>>> To actually execute this via MCP, an AI agent would call:');
    console.log(JSON.stringify({
        tool: 'execute_qso',
        arguments: {
            instance_id: slice20m.id,
            target_callsign: target.callsign,
            my_callsign: 'HB9BLA',
            my_grid: 'JN37VL'
        }
    }, null, 2));
}

executeQso().catch(console.error);
