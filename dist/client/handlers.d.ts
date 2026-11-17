import { type ActionResult, type BrowserRequestType, type Description, type ErrorCode, type GetStateResult, type LogsResult, type SetStateResult } from "../shared/protocol.js";
export declare class HandlerError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode, message: string);
}
export declare const describe: () => Description;
export interface GetStateParams {
    readonly name?: string;
    readonly path?: string;
    readonly depth?: number;
    readonly maxChars?: number;
}
export declare const getState: (params?: GetStateParams) => GetStateResult;
export interface SetStateParams {
    readonly name?: string;
    readonly path?: string;
    readonly value?: unknown;
}
export declare const setState: (params: SetStateParams) => SetStateResult;
export interface TriggerActionParams {
    readonly name?: string;
    readonly args?: unknown;
    readonly maxChars?: number;
}
export declare const triggerAction: (params: TriggerActionParams) => Promise<ActionResult>;
export interface GetLogsParams {
    readonly limit?: number;
    readonly since?: number;
    readonly name?: string;
}
export declare const getLogEntries: (params?: GetLogsParams) => LogsResult;
export declare const clearLogEntries: () => {
    cleared: number;
};
export declare const handleRequest: (type: BrowserRequestType | string, params?: Record<string, unknown>) => Promise<unknown>;
