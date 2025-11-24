// WSJT-X UDP Message Types (QQT encoding)
export enum WsjtxMessageType {
    HEARTBEAT = 0,
    STATUS = 1,
    DECODE = 2,
    CLEAR = 3,
    REPLY = 4,
    QSO_LOGGED = 5,
    CLOSE = 6,
    REPLAY = 7,
    HALT_TX = 8,
    FREE_TEXT = 9,
    WSPR_DECODE = 10,
    LOCATION = 11,
    LOGGED_ADIF = 12,
    HIGHLIGHT_CALLSIGN = 13,
}

export interface WsjtxDecode {
    id: string;
    newDecode: boolean;
    time: number;
    snr: number;
    deltaTime: number;
    deltaFrequency: number;
    mode: string;
    message: string;
    lowConfidence: boolean;
    offAir: boolean;
}

export interface WsjtxStatus {
    id: string;
    dialFrequency: number;
    mode: string;
    dxCall: string;
    report: string;
    txMode: string;
    txEnabled: boolean;
    transmitting: boolean;
    decoding: boolean;
    rxDF: number;
    txDF: number;
    deCall: string;
    deGrid: string;
    dxGrid: string;
    txWatchdog: boolean;
    subMode: string;
    fastMode: boolean;
    specialOpMode: number;
    frequencyTolerance: number;
    trPeriod: number;
    configurationName: string;
}
