// Direct QSO test bypassing MCP - calls QsoStateMachine directly
import { QsoStateMachine } from './src/wsjtx/QsoStateMachine';
import { UdpSender } from './src/wsjtx/UdpSender';

const udpSender = new UdpSender(2239);  // Channel C (20m) UDP port
const qsoMachine = new QsoStateMachine('Slice-C', udpSender);

console.log('\n=== Testing QSO with PD1HPB on 20m (-16dB SNR) ===\n');
console.log('Target: PD1HPB');
console.log('Grid: JO22');
console.log('Channel: C (20m, 14.074 MHz)');
console.log('\nStarting QSO...\n');

qsoMachine.on('stateChange', (state: string) => {
    console.log(`[State] ${state}`);
});

qsoMachine.on('complete', (result: any) => {
    console.log('\n=== QSO COMPLETE ===');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
});

qsoMachine.on('failed', (error: any) => {
    console.log('\n=== QSO FAILED ===');
    console.error(error);
    process.exit(1);
});

// Start the QSO
qsoMachine.startQso('PD1HPB', 'JO22');

// Timeout after 5 minutes
setTimeout(() => {
    console.log('\n=== QSO TIMEOUT ===');
    process.exit(1);
}, 300000);
