// Public API for the devtools bridge (browser-side)
export { registerAtom, registerAction, registerDerived, unregisterAtom, unregisterAction, unregisterDerived, } from "./action-registry.js";
export { wrapAction } from "./wrap-action.js";
export { wrapEffect } from "./wrap-effect.js";
export { connectDevtools } from "./devtools-client.js";
export { installGlobal } from "./global.js";
export { VERSION } from "../shared/version.js";
import { connectDevtools } from "./devtools-client.js";
/**
 * Initialize the devtools bridge.
 * Connects the WebSocket client and returns a cleanup function.
 */
export const initDevtools = (options) => {
    console.log("[Devtools Bridge] initializing MCP devtools bridge");
    return connectDevtools(options);
};
