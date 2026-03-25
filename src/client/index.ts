// Public API for the devtools bridge (browser-side)

export { registerAtom, registerAction } from "./action-registry";
export { wrapAction } from "./wrap-action";
export { connectDevtools } from "./devtools-client";
export type { Watchable, ActionFn } from "./types";
export type { ConnectOptions } from "./devtools-client";

import { connectDevtools } from "./devtools-client";
import type { ConnectOptions } from "./devtools-client";

/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export const initDevtools = (options?: ConnectOptions): (() => void) => {
    console.log("[devtools] initializing MCP devtools bridge");
    return connectDevtools(options);
};
