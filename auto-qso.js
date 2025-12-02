#!/usr/bin/env node
/**
 * Autonomous QSO execution script
 * Usage: node auto-qso.js
 * Finds the strongest CQ calling station and starts a QSO
 */

const http = require('http');

const MY_CALLSIGN = 'HB9BLA';
const MY_GRID = 'JN37VL';

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JSON: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function httpPost(path, body) {
    return new Promise((resolve, reject) => {
        const jsonBody = JSON.stringify(body);
        const options = {
            hostname: 'localhost',
            port: 3001,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JSON: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.write(jsonBody);
        req.end();
    });
}

async function findStrongestCQStation() {
    console.log('Querying slices for decoded stations...');
    const slices = await httpGet('/api/slices');

    let strongestStation = null;
    let highestSNR = -999;
    let bestSlice = null;

    // Iterate through all slices
    for (const slice of slices) {
        if (slice.band !== '20m') {
            continue;
        }
        console.log(`\nSlice ${slice.id} (${slice.band} - ${slice.dialFrequency / 1000000} MHz):`);

        if (!slice.stations || slice.stations.length === 0) {
            console.log('  No stations decoded');
            continue;
        }

        // Find CQ stations in this slice
        const cqStations = slice.stations.filter(station => {
            return station.message && station.message.startsWith('CQ ');
        });

        if (cqStations.length === 0) {
            console.log(`  ${slice.stations.length} stations decoded, but none calling CQ`);
            continue;
        }

        console.log(`  ${cqStations.length} CQ stations found`);

        // Find strongest CQ station in this slice
        for (const station of cqStations) {
            const snr = station.snr || -999;
            console.log(`    ${station.callsign} (${station.grid || '????'}): SNR ${snr > 0 ? '+' : ''}${snr}dB - "${station.message}"`);

            if (snr > highestSNR) {
                highestSNR = snr;
                strongestStation = station;
                bestSlice = slice;
            }
        }
    }

    return { station: strongestStation, slice: bestSlice, snr: highestSNR };
}

async function main() {
    try {
        console.log('='.repeat(70));
        console.log(' AUTONOMOUS QSO FINDER');
        console.log('='.repeat(70));

        const { station, slice, snr } = await findStrongestCQStation();

        if (!station) {
            console.log('\n❌ No CQ calling stations found on any band.');
            console.log('   Waiting for stations to call CQ...');
            process.exit(0);
        }

        console.log('\n' + '='.repeat(70));
        console.log(' STRONGEST CQ STATION FOUND:');
        console.log('='.repeat(70));
        console.log(`  Callsign:  ${station.callsign}`);
        console.log(`  Grid:      ${station.grid || 'Unknown'}`);
        console.log(`  SNR:       ${snr > 0 ? '+' : ''}${snr}dB`);
        console.log(`  Band:      ${slice.band} (${slice.dialFrequency / 1000000} MHz)`);
        console.log(`  Slice:     ${slice.id}`);
        console.log(`  Message:   "${station.message}"`);
        console.log('='.repeat(70));

        // Execute QSO
        console.log(`\n🚀 Starting autonomous QSO with ${station.callsign}...`);

        const instanceId = `Slice-${slice.id}`;
        const response = await httpPost('/api/qso/execute', {
            instanceId,
            targetCallsign: station.callsign,
            myCallsign: MY_CALLSIGN,
            myGrid: MY_GRID
        });

        if (response.success) {
            console.log(`\n✅ ${response.message}`);
            console.log('\nThe QSO state machine will now:');
            console.log(`  1. Send your callsign and grid (${MY_CALLSIGN} ${MY_GRID})`);
            console.log(`  2. Wait for signal report from ${station.callsign}`);
            console.log('  3. Send signal report back');
            console.log('  4. Wait for RR73');
            console.log('  5. Send 73 to complete QSO');
            console.log(`\nWatch WSJT-X ${instanceId} window for the automated sequence.`);
        } else {
            console.log(`\n❌ Failed to start QSO: ${response.error}`);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

main();
