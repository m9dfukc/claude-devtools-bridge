export { registerAtom, registerAction } from "./action-registry";
export { wrapAction } from "./wrap-action";
export { connectDevtools } from "./devtools-client";
export type { Watchable, ActionFn } from "./types";
export type { ConnectOptions } from "./devtools-client";
import type { ConnectOptions } from "./devtools-client";
/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export declare const initDevtools: (options?: ConnectOptions) => (() => void);
//# sourceMappingURL=index.d.ts.map