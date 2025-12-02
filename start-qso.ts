/**
 * Direct script to start a QSO with I6WJB on 40m
 * This bypasses MCP and directly calls the WsjtxManager
 */

import { WsjtxManager } from './src/wsjtx/WsjtxManager';
import { loadConfig } from './src/SettingsManager';

async function main() {
    console.log('Loading config...');
    const config = loadConfig();

    console.log('Creating WsjtxManager...');
    const wsjtxManager = new WsjtxManager(config);

    // Give it a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\nInitiating QSO with I6WJB on 40m (Slice-D)...');
    console.log('  Target: I6WJB (Italy, JN72)');
    console.log('  My Call: HB9BLA');
    console.log('  My Grid: JN37VL');
    console.log('  Band: 40m (7.074 MHz)');
    console.log('  Instance: Slice-D');

    wsjtxManager.executeQso('Slice-D', 'I6WJB', 'HB9BLA', 'JN37VL');

    console.log('\n✓ QSO initiated!');
    console.log('Watch WSJT-X Slice-D window for the automated QSO sequence.');
    console.log('The QSO state machine will:');
    console.log('  1. Send your callsign and grid (HB9BLA JN37VL)');
    console.log('  2. Wait for signal report from I6WJB');
    console.log('  3. Send signal report back');
    console.log('  4. Wait for RR73');
    console.log('  5. Send 73 to complete QSO');
}

main().catch(console.error);
