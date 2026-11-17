export { registerAtom, registerAction, registerDerived, unregisterAtom, unregisterAction, unregisterDerived, } from "./action-registry.js";
export { wrapAction } from "./wrap-action.js";
export { wrapEffect } from "./wrap-effect.js";
export { connectDevtools } from "./devtools-client.js";
export { installGlobal } from "./global.js";
export { VERSION } from "../shared/version.js";
export type { Watchable, Derivable, ActionFn, DisposeFn, AtomOptions } from "./types.js";
export type { ConnectOptions } from "./devtools-client.js";
export type { DevtoolsBridgeGlobal } from "./global.js";
export type { LogEntry, StateDiff, Change } from "../shared/protocol.js";
import type { ConnectOptions } from "./devtools-client.js";
import type { DisposeFn } from "./types.js";
/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export declare const initDevtools: (options?: ConnectOptions) => DisposeFn;
