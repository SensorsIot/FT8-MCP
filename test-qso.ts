import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

async function testQso() {
    console.log('=== WSJT-X QSO Execution Test ===\n');

    // Create MCP client
    const transport = new StdioClientTransport({
        command: 'node',
        args: ['dist/index.js'],
    });

    const client = new Client({
        name: 'qso-test-client',
        version: '1.0.0',
    }, {
        capabilities: {},
    });

    try {
        console.log('Connecting to MCP server...');
        await client.connect(transport);
        console.log('✓ Connected to MCP server\n');

        // Step 1: Get current decodes
        console.log('Step 1: Getting current decodes...');
        const decodesResult = await client.callTool({
            name: 'wsjtx_get_decodes',
            arguments: {
                max_age_seconds: 60,
            },
        });

        if (!decodesResult.content || (decodesResult.content as any[]).length === 0) {
            console.log('✗ No decodes available');
            return;
        }

        const decodesText = (decodesResult.content as any)[0].text;
        const decodes = JSON.parse(decodesText);
        console.log(`✓ Found ${decodes.length} recent decodes\n`);

        // Step 2: Find CQ calling stations
        console.log('Step 2: Finding CQ calling stations...');
        const cqStations = decodes.filter((d: any) =>
            d.raw_text && d.raw_text.includes('CQ ')
        );

        if (cqStations.length === 0) {
            console.log('✗ No CQ calling stations found');
            console.log('Available stations:');
            decodes.slice(0, 10).forEach((d: any) => {
                console.log(`  ${d.call || 'N/A'}: ${d.raw_text} (${d.snr_db}dB)`);
            });
            return;
        }

        console.log(`✓ Found ${cqStations.length} CQ calling stations:`);
        cqStations.slice(0, 5).forEach((d: any, i: number) => {
            console.log(`  ${i + 1}. ${d.call}: ${d.raw_text} (${d.snr_db}dB @ ${d.audio_offset_hz}Hz)`);
        });

        // Step 3: Select the strongest CQ station
        const strongest = cqStations.reduce((prev: any, curr: any) =>
            (curr.snr_db > prev.snr_db) ? curr : prev
        );

        console.log(`\n✓ Selected strongest station: ${strongest.call} (${strongest.snr_db}dB)`);
        console.log(`  Message: ${strongest.raw_text}`);
        console.log(`  Frequency: ${strongest.audio_offset_hz}Hz`);
        console.log(`  Instance: ${strongest.instance_id}\n`);

        // Step 4: Get instance info to get our callsign and grid
        console.log('Step 4: Getting instance information...');
        const instancesResult = await client.callTool({
            name: 'wsjtx_list_instances',
            arguments: {},
        });

        const instancesText = (instancesResult.content as any)?.[0]?.text || '[]';
        const instances = JSON.parse(instancesText);
        const targetInstance = instances.find((i: any) => i.id === strongest.instance_id);

        if (!targetInstance) {
            console.log(`✗ Could not find instance ${strongest.instance_id}`);
            return;
        }

        console.log(`✓ Instance: ${targetInstance.id}`);
        console.log(`  My Call: ${targetInstance.myCall || 'HB9BLA'}`);
        console.log(`  My Grid: ${targetInstance.myGrid || 'JN37'}\n`);

        const myCall = targetInstance.myCall || 'HB9BLA';
        const myGrid = targetInstance.myGrid || 'JN37';

        // Step 5: Execute QSO
        console.log(`Step 5: Executing QSO with ${strongest.call}...`);
        console.log(`Command: execute_qso(${strongest.instance_id}, ${strongest.call}, ${myCall}, ${myGrid})\n`);

        const qsoResult = await client.callTool({
            name: 'execute_qso',
            arguments: {
                instance_id: strongest.instance_id,
                target_callsign: strongest.call,
                my_callsign: myCall,
                my_grid: myGrid,
            },
        });

        const qsoText = (qsoResult.content as any)?.[0]?.text || '';
        console.log('✓ QSO execution started:');
        console.log(qsoText);

        // Step 6: Monitor for a while
        console.log('\nStep 6: Monitoring QSO progress for 60 seconds...');
        console.log('(Watch WSJT-X window for TX activity)\n');

        await new Promise(resolve => setTimeout(resolve, 60000));

        console.log('\n=== Test Complete ===');

    } catch (error: any) {
        console.error('✗ Error:', error.message);
        if (error.code) {
            console.error(`  Error code: ${error.code}`);
        }
        if (error.data) {
            console.error(`  Details: ${JSON.stringify(error.data, null, 2)}`);
        }
    } finally {
        await client.close();
        console.log('Disconnected from MCP server');
    }
}

testQso().catch(console.error);
