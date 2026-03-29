export { registerAtom, registerAction, registerDerived, unregisterAtom, unregisterAction, unregisterDerived, } from "./action-registry";
export { wrapAction } from "./wrap-action";
export { wrapEffect } from "./wrap-effect";
export { connectDevtools } from "./devtools-client";
export type { Watchable, Derivable, ActionFn, DisposeFn } from "./types";
export type { ConnectOptions } from "./devtools-client";
import type { ConnectOptions } from "./devtools-client";
import type { DisposeFn } from "./types";
/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export declare const initDevtools: (options?: ConnectOptions) => DisposeFn;
//# sourceMappingURL=index.d.ts.map