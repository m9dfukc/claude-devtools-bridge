// Vite plugin adapter — mounts the devtools relay on Vite's HTTP server
import { WebSocketServer } from "ws";
import { createRelayFromWss } from "../relay/ws-relay.js";
const RELAY_PATH = "/devtools-bridge";
export const devtoolsBridgePlugin = () => {
    let cleanup;
    return {
        name: "devtools-bridge",
        configureServer(server) {
            const httpServer = server.httpServer;
            if (!httpServer)
                return;
            // noServer mode: we handle the upgrade event ourselves,
            // only forwarding requests that match RELAY_PATH.
            // Using `{ server: httpServer }` would add a catch-all
            // upgrade listener that races with Vite's HMR handler.
            const wss = new WebSocketServer({ noServer: true });
            const relay = createRelayFromWss(wss);
            cleanup = () => relay.close();
            httpServer.on("upgrade", (req, socket, head) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                if (url.pathname !== RELAY_PATH)
                    return;
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit("connection", ws, req);
                });
            });
            console.log(`[relay] mounted on path ${RELAY_PATH}`);
        },
        buildEnd() {
            cleanup?.();
        },
    };
};
//# sourceMappingURL=vite.js.map