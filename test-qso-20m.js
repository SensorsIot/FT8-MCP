// Test QSO execution on 20m with weak station
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function testQso() {
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/index.js']
    });

    const client = new Client({
        name: 'test-qso-client',
        version: '1.0.0'
    }, {
        capabilities: {}
    });

    await client.connect(transport);
    console.log('Connected to MCP server');

    try {
        // Execute QSO with PD1HPB on 20m (weak signal at -16dB)
        console.log('\n=== Testing QSO with PD1HPB (20m, -16dB SNR) ===\n');

        const result = await client.callTool({
            name: 'execute_qso',
            arguments: {
                channel: 'C',
                targetCall: 'PD1HPB',
                targetGrid: 'JO22'
            }
        });

        console.log('\n=== QSO Result ===');
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('QSO execution failed:', error);
    } finally {
        await client.close();
    }
}

testQso().catch(console.error);
