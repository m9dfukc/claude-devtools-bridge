// WebSocket relay — forwards messages between MCP server and browser clients

import { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

type Role = "mcp" | "browser";

interface RelayOptions {
    readonly path?: string;
    readonly bufferSize?: number;
}

interface Relay {
    close(): void;
}

const DEFAULT_PATH = "/devtools-bridge";
const DEFAULT_BUFFER_SIZE = 50;

export const createRelayFromWss = (
    wss: WebSocketServer,
    bufferSize: number = DEFAULT_BUFFER_SIZE,
): Relay => {
    const clients: Record<Role, WebSocket | null> = {
        mcp: null,
        browser: null,
    };
    const buffers: Record<Role, string[]> = { mcp: [], browser: [] };

    const otherRole = (role: Role): Role =>
        role === "mcp" ? "browser" : "mcp";

    const flushBuffer = (targetRole: Role): void => {
        const target = clients[targetRole];
        if (!target || target.readyState !== WebSocket.OPEN) return;
        const buf = buffers[targetRole];
        for (const msg of buf) {
            target.send(msg);
        }
        buf.length = 0;
    };

    const forward = (fromRole: Role, data: string): void => {
        const target = otherRole(fromRole);
        const targetWs = clients[target];
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(data);
        } else {
            const buf = buffers[target];
            buf.push(data);
            if (buf.length > bufferSize) {
                buf.splice(0, buf.length - bufferSize);
            }
        }
    };

    wss.on("connection", (ws, req) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const role = url.searchParams.get("role") as Role | null;
        if (role !== "mcp" && role !== "browser") {
            console.error(
                `[relay] rejected connection — missing or invalid role param: ${role ?? "none"}`,
            );
            ws.close(4000, "Missing ?role=mcp|browser query param");
            return;
        }

        // Close previous client in same role slot
        if (clients[role] && clients[role]!.readyState === WebSocket.OPEN) {
            clients[role]!.close(4001, "Replaced by new connection");
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
export const createRelay = (
    httpServer: HttpServer,
    options?: RelayOptions,
): Relay => {
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
export const createStandaloneRelay = (
    port: number,
    options?: RelayOptions,
): Relay => {
    const path = options?.path ?? DEFAULT_PATH;
    const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;

    const wss = new WebSocketServer({ port, path });

    wss.on("listening", () => {
        console.error(`[relay] standalone server listening on :${port}${path}`);
    });

    return createRelayFromWss(wss, bufferSize);
};
