import { clearLogEntries, describe, getLogEntries, getState, handleRequest, setState, triggerAction } from "./handlers.js";
export interface DevtoolsBridgeGlobal {
    readonly version: string;
    readonly protocol: number;
    readonly status: typeof describe;
    readonly getState: typeof getState;
    readonly setState: (name: string, value: unknown, path?: string) => ReturnType<typeof setState>;
    readonly triggerAction: (name: string, ...args: unknown[]) => ReturnType<typeof triggerAction>;
    readonly getLogs: typeof getLogEntries;
    readonly clearLogs: typeof clearLogEntries;
    readonly request: typeof handleRequest;
}
export declare const installGlobal: () => void;
