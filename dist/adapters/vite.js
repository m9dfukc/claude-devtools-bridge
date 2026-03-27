// Vite plugin adapter — mounts the devtools relay on Vite's HTTP server
import { createRelay } from "../relay/ws-relay.js";
export const devtoolsBridgePlugin = () => {
    let cleanup;
    return {
        name: "devtools-bridge",
        configureServer(server) {
            // Vite's httpServer is HttpServer | Http2SecureServer | null.
            // The relay only needs the "upgrade" event, which both provide.
            const httpServer = server.httpServer;
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
//# sourceMappingURL=vite.js.map