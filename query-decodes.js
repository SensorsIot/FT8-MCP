#!/usr/bin/env node
/**
 * Query MCP server for current decodes
 * Returns JSON array of decoded stations
 */

const { spawn } = require('child_process');
const readline = require('readline');

const mcp = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit']
});

const rl = readline.createInterface({
    input: mcp.stdout,
    crlfDelay: Infinity
});

let requestId = 1;
let initialized = false;

// Send initialize request
const initRequest = {
    jsonrpc: '2.0',
    id: requestId++,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
            name: 'query-decodes-client',
            version: '1.0.0'
        }
    }
};

mcp.stdin.write(JSON.stringify(initRequest) + '\n');

rl.on('line', (line) => {
    try {
        const response = JSON.parse(line);

        if (response.id === 1 && !initialized) {
            // Initialized, now query decodes resource
            initialized = true;

            const readRequest = {
                jsonrpc: '2.0',
                id: requestId++,
                method: 'resources/read',
                params: {
                    uri: 'wsjt-x://decodes'
                }
            };

            mcp.stdin.write(JSON.stringify(readRequest) + '\n');
        } else if (response.result && response.result.contents) {
            // Got the decodes data
            const content = response.result.contents[0];
            if (content && content.text) {
                // Output just the JSON data
                console.log(content.text);
            }
            mcp.kill();
            process.exit(0);
        }
    } catch (e) {
        // Ignore non-JSON lines
    }
});

mcp.on('error', (err) => {
    console.error('Error:', err);
    process.exit(1);
});

setTimeout(() => {
    console.error('Timeout waiting for response');
    mcp.kill();
    process.exit(1);
}, 5000);
