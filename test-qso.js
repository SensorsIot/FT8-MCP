#!/usr/bin/env node
/**
 * Quick MCP client to test execute_qso tool
 * Sends an MCP request to start a QSO with I6WJB on 40m
 */

const readline = require('readline');
const { spawn } = require('child_process');

// Start the MCP server
const mcp = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
    input: mcp.stdout,
    crlfDelay: Infinity
});

// Send MCP initialize request
const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
            name: 'test-qso-client',
            version: '1.0.0'
        }
    }
};

console.log('Sending initialize request...');
mcp.stdin.write(JSON.stringify(initRequest) + '\n');

let initialized = false;
let requestId = 2;

rl.on('line', (line) => {
    try {
        const response = JSON.parse(line);
        console.log('Received:', JSON.stringify(response, null, 2));

        if (response.id === 1 && !initialized) {
            // Initialization complete, send execute_qso request
            initialized = true;
            console.log('\nSending execute_qso request for I6WJB on 40m...');

            const qsoRequest = {
                jsonrpc: '2.0',
                id: requestId++,
                method: 'tools/call',
                params: {
                    name: 'execute_qso',
                    arguments: {
                        instanceId: 'Slice-D',  // 40m channel
                        targetCallsign: 'I6WJB',
                        myCallsign: 'HB9BLA',
                        myGrid: 'JN37VL'
                    }
                }
            };

            mcp.stdin.write(JSON.stringify(qsoRequest) + '\n');
        } else if (response.result) {
            // Got result, clean up
            console.log('\n✓ QSO initiated successfully!');
            console.log('Watch the WSJT-X window for updates...');
            setTimeout(() => {
                mcp.kill();
                process.exit(0);
            }, 2000);
        }
    } catch (e) {
        // Ignore non-JSON lines (stdout from server)
    }
});

mcp.on('error', (err) => {
    console.error('Error:', err);
    process.exit(1);
});

mcp.on('exit', (code) => {
    console.log(`MCP server exited with code ${code}`);
    process.exit(code);
});
