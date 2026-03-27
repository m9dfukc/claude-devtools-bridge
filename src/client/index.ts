// Public API for the devtools bridge (browser-side)

export { registerAtom, registerAction, registerDerived } from "./action-registry";
export { wrapAction } from "./wrap-action";
export { wrapEffect } from "./wrap-effect";
export { connectDevtools } from "./devtools-client";
export type { Watchable, Derivable, ActionFn } from "./types";
export type { ConnectOptions } from "./devtools-client";

import { connectDevtools } from "./devtools-client";
import type { ConnectOptions } from "./devtools-client";

/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export const initDevtools = (options?: ConnectOptions): (() => void) => {
    console.log("[Devtools Bridge] initializing MCP devtools bridge");
    return connectDevtools(options);
};
