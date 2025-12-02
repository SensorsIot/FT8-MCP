import { EventEmitter } from 'events';
import { WsjtxDecode } from './types';
import { UdpSender } from './UdpSender';

export enum QsoState {
    IDLE = 'IDLE',
    CALLING_CQ = 'CALLING_CQ',
    WAITING_REPLY = 'WAITING_REPLY',
    SENDING_REPORT = 'SENDING_REPORT',
    WAITING_REPORT = 'WAITING_REPORT',
    SENDING_RR73 = 'SENDING_RR73',
    WAITING_73 = 'WAITING_73',
    COMPLETE = 'COMPLETE',
    FAILED = 'FAILED',
}

export interface QsoConfig {
    instanceId: string;
    targetCallsign: string;
    myCallsign: string;
    myGrid: string;
    udpPort?: number;
    timeout?: number; // milliseconds
    maxRetries?: number;
    initialDecode?: WsjtxDecode; // The decode to respond to (simulates double-click)
}

export class QsoStateMachine extends EventEmitter {
    private state: QsoState = QsoState.IDLE;
    private config: QsoConfig;
    private udpSender: UdpSender;
    private timeout: number;
    private maxRetries: number;
    private retryCount: number = 0;
    private timeoutHandle?: NodeJS.Timeout;
    private receivedReport?: string;

    constructor(config: QsoConfig) {
        super();
        this.config = config;
        this.timeout = config.timeout || 15000; // 15 seconds (FT8 cycle)
        this.maxRetries = config.maxRetries || 3;
        this.udpSender = new UdpSender(config.udpPort || 2237);
    }

    public start(): void {
        if (this.state !== QsoState.IDLE) {
            throw new Error('QSO already in progress');
        }

        console.log(`Starting QSO with ${this.config.targetCallsign}`);
        this.setState(QsoState.CALLING_CQ);
        this.callCQ();
    }

    public handleDecode(decode: WsjtxDecode): void {
        // Only process messages for our instance
        if (decode.id !== this.config.instanceId) {
            return;
        }

        const message = decode.message.trim();
        console.log(`[QSO] State: ${this.state}, Message: ${message}`);

        switch (this.state) {
            case QsoState.WAITING_REPLY:
                if (this.isCallingMe(message)) {
                    this.clearTimeout();
                    this.setState(QsoState.SENDING_REPORT);
                    this.sendReport(decode);
                }
                break;

            case QsoState.WAITING_REPORT:
                if (this.isReportForMe(message)) {
                    this.clearTimeout();
                    this.receivedReport = this.extractReport(message);
                    this.setState(QsoState.SENDING_RR73);
                    this.sendRR73(decode);
                }
                break;

            case QsoState.WAITING_73:
                if (this.is73ForMe(message)) {
                    this.clearTimeout();
                    this.setState(QsoState.COMPLETE);
                    this.complete();
                }
                break;
        }
    }

    private callCQ(): void {
        // If we have an initialDecode, use Reply (simulates double-click on their CQ)
        // This is the proper way to initiate a QSO in WSJT-X
        if (this.config.initialDecode) {
            const message = `${this.config.targetCallsign} ${this.config.myCallsign} ${this.config.myGrid}`;
            console.log(`[QSO] Sending Reply (double-click): ${message}`);
            this.sendMessage(message, this.config.initialDecode);
        } else {
            // Fallback: send as free text if no decode available
            const message = `${this.config.targetCallsign} ${this.config.myCallsign} ${this.config.myGrid}`;
            console.log(`[QSO] Sending FreeText: ${message}`);
            this.sendMessage(message);
        }
        this.setState(QsoState.WAITING_REPLY);
        this.startTimeout();
    }

    private sendReport(decode: WsjtxDecode): void {
        const report = this.formatReport(decode.snr);
        const message = `${this.config.targetCallsign} ${this.config.myCallsign} ${report}`;
        this.sendMessage(message, decode);
        this.setState(QsoState.WAITING_REPORT);
        this.startTimeout();
    }

    private sendRR73(decode: WsjtxDecode): void {
        const message = `${this.config.targetCallsign} ${this.config.myCallsign} RR73`;
        this.sendMessage(message, decode);
        this.setState(QsoState.WAITING_73);
        this.startTimeout();
    }

    private sendMessage(text: string, decode?: WsjtxDecode): void {
        console.log(`[QSO] Sending: ${text}`);

        if (decode) {
            // Reply to specific decode
            this.udpSender.sendReply(
                this.config.instanceId,
                decode.time,
                decode.snr,
                decode.deltaTime,
                decode.deltaFrequency,
                decode.mode,
                text
            );
        } else {
            // Send free text
            this.udpSender.sendFreeText(this.config.instanceId, text, true);
        }
    }

    private isCallingMe(message: string): boolean {
        // Match: "MYCALL THEIRCALL GRID" or "MYCALL THEIRCALL"
        const pattern = new RegExp(`${this.config.myCallsign}\\s+${this.config.targetCallsign}`, 'i');
        return pattern.test(message);
    }

    private isReportForMe(message: string): boolean {
        // Match: "MYCALL THEIRCALL +/-XX" or "MYCALL THEIRCALL RXX"
        const pattern = new RegExp(`${this.config.myCallsign}\\s+${this.config.targetCallsign}\\s+[R+-]\\d+`, 'i');
        return pattern.test(message);
    }

    private is73ForMe(message: string): boolean {
        // Match: "MYCALL THEIRCALL 73" or "THEIRCALL MYCALL 73"
        return message.includes('73') &&
            (message.includes(this.config.myCallsign) || message.includes(this.config.targetCallsign));
    }

    private extractReport(message: string): string {
        const match = message.match(/([R+-]\d+)/);
        return match ? match[1] : '';
    }

    private formatReport(snr: number): string {
        return snr >= 0 ? `+${snr.toString().padStart(2, '0')}` : snr.toString().padStart(3, '0');
    }

    private setState(newState: QsoState): void {
        const oldState = this.state;
        this.state = newState;
        console.log(`[QSO] State transition: ${oldState} -> ${newState}`);
        this.emit('state-change', { oldState, newState });
    }

    private startTimeout(): void {
        this.clearTimeout();
        this.timeoutHandle = setTimeout(() => {
            this.handleTimeout();
        }, this.timeout);
    }

    private clearTimeout(): void {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
    }

    private handleTimeout(): void {
        console.log(`[QSO] Timeout in state: ${this.state}`);
        this.retryCount++;

        if (this.retryCount >= this.maxRetries) {
            console.log(`[QSO] Max retries reached, failing QSO`);
            this.setState(QsoState.FAILED);
            this.fail('Max retries exceeded');
        } else {
            console.log(`[QSO] Retry ${this.retryCount}/${this.maxRetries}`);
            // Retry current state
            switch (this.state) {
                case QsoState.WAITING_REPLY:
                    this.callCQ();
                    break;
                case QsoState.WAITING_REPORT:
                case QsoState.WAITING_73:
                    // Wait for next cycle
                    this.startTimeout();
                    break;
            }
        }
    }

    private complete(): void {
        this.clearTimeout();
        console.log(`[QSO] QSO complete with ${this.config.targetCallsign}`);
        this.emit('complete', {
            targetCallsign: this.config.targetCallsign,
            report: this.receivedReport,
        });
        this.cleanup();
    }

    private fail(reason: string): void {
        this.clearTimeout();
        console.log(`[QSO] QSO failed: ${reason}`);
        this.emit('failed', { reason });
        this.cleanup();
    }

    private cleanup(): void {
        this.udpSender.close();
    }

    public abort(): void {
        console.log(`[QSO] Aborting QSO`);
        this.setState(QsoState.FAILED);
        this.fail('Aborted by user');
    }

    public getState(): QsoState {
        return this.state;
    }
}
