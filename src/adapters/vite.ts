// Vite plugin adapter — mounts the devtools relay on Vite's HTTP server

import type { Server as HttpServer } from "node:http";
import type { Plugin } from "vite";
import { createRelay } from "../relay/ws-relay.js";

export const devtoolsBridgePlugin = (): Plugin => {
    let cleanup: (() => void) | undefined;
    return {
        name: "devtools-bridge",
        configureServer(server) {
            // Vite's httpServer is HttpServer | Http2SecureServer | null.
            // The relay only needs the "upgrade" event, which both provide.
            const httpServer = server.httpServer as HttpServer | null;
            if (httpServer) {
                const relay = createRelay(httpServer);
                cleanup = () => relay.close();
            }
        },
        buildEnd() {
            cleanup?.();
        },
    };
};
