// Public API for the devtools bridge (browser-side)
export { registerAtom, registerAction, registerDerived, unregisterAtom, unregisterAction, unregisterDerived, } from "./action-registry";
export { wrapAction } from "./wrap-action";
export { wrapEffect } from "./wrap-effect";
export { connectDevtools } from "./devtools-client";
import { connectDevtools } from "./devtools-client";
/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export const initDevtools = (options) => {
    console.log("[Devtools Bridge] initializing MCP devtools bridge");
    return connectDevtools(options);
};
//# sourceMappingURL=index.js.map