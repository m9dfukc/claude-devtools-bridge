// `window.__DEVTOOLS_BRIDGE__` — the same handlers without any transport.
// Fallback for when the MCP server is not connected: any tool that can run
// JavaScript in the page (browser automation, the console) can use it.

import { PROTOCOL_VERSION } from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import {
    clearLogEntries,
    describe,
    getLogEntries,
    getState,
    handleRequest,
    setState,
    triggerAction,
} from "./handlers.js";

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

const KEY = "__DEVTOOLS_BRIDGE__";

export const installGlobal = (): void => {
    const g = globalThis as Record<string, unknown>;
    if (g[KEY]) return;
    const api: DevtoolsBridgeGlobal = {
        version: VERSION,
        protocol: PROTOCOL_VERSION,
        status: describe,
        getState,
        setState: (name, value, path) => setState({ name, value, ...(path !== undefined ? { path } : {}) }),
        triggerAction: (name, ...args) => triggerAction({ name, args }),
        getLogs: getLogEntries,
        clearLogs: clearLogEntries,
        request: handleRequest,
    };
    g[KEY] = api;
};
