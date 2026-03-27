// WebSocket relay — forwards messages between MCP server and browser clients
import { WebSocketServer, WebSocket } from "ws";
const DEFAULT_PATH = "/devtools-bridge";
const DEFAULT_BUFFER_SIZE = 50;
export const createRelayFromWss = (wss, bufferSize = DEFAULT_BUFFER_SIZE) => {
    const clients = {
        mcp: null,
        browser: null,
    };
    const buffers = { mcp: [], browser: [] };
    const otherRole = (role) => role === "mcp" ? "browser" : "mcp";
    const flushBuffer = (targetRole) => {
        const target = clients[targetRole];
        if (!target || target.readyState !== WebSocket.OPEN)
            return;
        const buf = buffers[targetRole];
        for (const msg of buf) {
            target.send(msg);
        }
        buf.length = 0;
    };
    const forward = (fromRole, data) => {
        const target = otherRole(fromRole);
        const targetWs = clients[target];
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(data);
        }
        else {
            const buf = buffers[target];
            buf.push(data);
            if (buf.length > bufferSize) {
                buf.splice(0, buf.length - bufferSize);
            }
        }
    };
    wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const role = url.searchParams.get("role");
        if (role !== "mcp" && role !== "browser") {
            console.error(`[relay] rejected connection — missing or invalid role param: ${role ?? "none"}`);
            ws.close(4000, "Missing ?role=mcp|browser query param");
            return;
        }
        // Close previous client in same role slot
        if (clients[role] && clients[role].readyState === WebSocket.OPEN) {
            clients[role].close(4001, "Replaced by new connection");
        }
        clients[role] = ws;
        console.error(`[relay] ${role} client connected`);
        // Flush any buffered messages for this role
        flushBuffer(role);
        ws.on("message", (raw) => {
            forward(role, raw.toString());
        });
        ws.on("close", () => {
            console.error(`[relay] ${role} client disconnected`);
            if (clients[role] === ws) {
                clients[role] = null;
            }
        });
    });
    return {
        close: () => {
            wss.close();
            clients.mcp = null;
            clients.browser = null;
            buffers.mcp.length = 0;
            buffers.browser.length = 0;
        },
    };
};
/** Mount relay on an existing HTTP server (Vite, Express, etc.) */
export const createRelay = (httpServer, options) => {
    const path = options?.path ?? DEFAULT_PATH;
    const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;
    const wss = new WebSocketServer({
        server: httpServer,
        path,
    });
    console.error(`[relay] mounted on path ${path}`);
    return createRelayFromWss(wss, bufferSize);
};
/** Standalone mode — creates its own HTTP server */
export const createStandaloneRelay = (port, options) => {
    const path = options?.path ?? DEFAULT_PATH;
    const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;
    const wss = new WebSocketServer({ port, path });
    wss.on("listening", () => {
        console.error(`[relay] standalone server listening on :${port}${path}`);
    });
    return createRelayFromWss(wss, bufferSize);
};
//# sourceMappingURL=ws-relay.js.map