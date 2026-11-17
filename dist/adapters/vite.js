// Vite plugin adapter — mounts the devtools relay on Vite's dev server
import { createRelay } from "../relay/ws-relay.js";
export const devtoolsBridgePlugin = (options = {}) => ({
    name: "devtools-bridge",
    apply: "serve",
    configureServer(server) {
        const httpServer = server.httpServer;
        if (!httpServer)
            return; // middleware mode — mount with adapters/node instead
        // The relay removes itself when the HTTP server closes (also on
        // Vite restarts), and writes the real port — which may differ from
        // the configured one — to the discovery file.
        createRelay(httpServer, {
            root: server.config.root,
            ...options,
        });
    },
});
