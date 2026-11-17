// Vite plugin adapter — mounts the devtools relay on Vite's dev server

import type { Server as HttpServer } from "node:http";
import type { Plugin } from "vite";
import { createRelay, type RelayOptions } from "../relay/ws-relay.js";

export type { RelayOptions } from "../relay/ws-relay.js";

export const devtoolsBridgePlugin = (options: RelayOptions = {}): Plugin => ({
    name: "devtools-bridge",
    apply: "serve",
    configureServer(server) {
        const httpServer = server.httpServer;
        if (!httpServer) return; // middleware mode — mount with adapters/node instead
        // The relay removes itself when the HTTP server closes (also on
        // Vite restarts), and writes the real port — which may differ from
        // the configured one — to the discovery file.
        createRelay(httpServer as unknown as HttpServer, {
            root: server.config.root,
            ...options,
        });
    },
});
