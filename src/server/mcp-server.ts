// Standalone Node MCP server — bridges Claude ↔ browser via WebSocket relay
//
// The MCP server connects as a WebSocket CLIENT to a relay hosted by the
// dev server (Vite, Express, etc.). This allows it to work inside Claude
// Code's sandbox, which blocks port binding but allows outbound connections.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket } from "ws";
import { z } from "zod";
import { formatLogs } from "./format-logs";
import type { ClientMessage, LogEntry } from "../client/types";

const TIMEOUT_MS = 10_000;
const RECONNECT_MS = 2_000;
const PORT = parseInt(process.env["DEVTOOLS_PORT"] ?? "5173", 10);
const RELAY_PATH = process.env["DEVTOOLS_PATH"] ?? "/devtools-bridge";

// --- WebSocket client state ---

let ws: WebSocket | null = null;
let disposed = false;
const pending = new Map<
    string,
    { resolve: (data: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

let nextId = 0;
const genId = (): string => `req_${++nextId}_${Date.now()}`;

// --- Connect to relay as WS client ---

const connectToRelay = (): void => {
    if (disposed) return;

    const url = `ws://localhost:${PORT}${RELAY_PATH}?role=mcp`;
    const socket = new WebSocket(url);

    socket.on("open", () => {
        console.log(`[mcp-devtools] connected to relay at ${url}`);
        ws = socket;
    });

    socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        const entry = pending.get(msg.id);
        if (entry) {
            clearTimeout(entry.timer);
            pending.delete(msg.id);
            entry.resolve(msg);
        }
    });

    socket.on("close", () => {
        console.warn("[mcp-devtools] relay connection closed, reconnecting...");
        if (ws === socket) ws = null;
        if (!disposed) setTimeout(connectToRelay, RECONNECT_MS);
    });

    socket.on("error", (err) => {
        // Log but don't crash — close event handles reconnect
        console.error(`[mcp-devtools] relay connection error: ${err.message}`);
        socket.close();
    });
};

connectToRelay();

// --- Helpers ---

const sendAndWait = <T>(message: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            reject(
                new Error(
                    "Not connected to relay. Ensure the dev server is running with the devtools-bridge plugin.",
                ),
            );
            return;
        }

        const id = genId();
        const msg = { ...message, id };

        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);

        pending.set(id, {
            resolve: resolve as (data: unknown) => void,
            timer,
        });

        ws.send(JSON.stringify(msg));
    });

// --- MCP server ---

const server = new McpServer({
    name: "app-devtools",
    version: "0.2.2",
});

server.registerTool("get_state", {
    description:
        "Get a snapshot of all registered state containers in the running app",
    annotations: { readOnlyHint: true },
}, async () => {
    try {
        const result = await sendAndWait<{
            data: Record<string, unknown>;
        }>({ type: "get_state" });
        return {
            content: [
                {
                    type: "text" as const,
                    text: JSON.stringify(result.data, null, 2),
                },
            ],
        };
    } catch (e) {
        return {
            content: [
                { type: "text" as const, text: (e as Error).message },
            ],
            isError: true,
        };
    }
});

// @ts-expect-error — MCP SDK registerTool hits TS2589 with multi-field inputSchema
server.registerTool("set_state", {
    description: "Set a specific state container value by name in the running app",
    inputSchema: {
        path: z.string().describe("State container name (e.g. 'app')"),
        value: z.string().describe("JSON-encoded value to set"),
    },
}, async ({ path, value }) => {
    try {
        const result = await sendAndWait<{
            success: boolean;
            error?: string;
        }>({ type: "set_state", path, value });
        if (!result.success) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: result.error ?? "Failed to set state",
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text" as const,
                    text: `Set "${path}" successfully.`,
                },
            ],
        };
    } catch (e) {
        return {
            content: [
                { type: "text" as const, text: (e as Error).message },
            ],
            isError: true,
        };
    }
});

server.registerTool("trigger_action", {
    description: "Invoke a registered action by name in the running app",
    inputSchema: {
        name: z.string().describe("Action name (e.g. 'fsm.next')"),
        payload: z
            .string()
            .optional()
            .describe("Optional JSON-encoded payload to pass to the action"),
    },
}, async ({ name, payload }) => {
    try {
        const result = await sendAndWait<{
            success: boolean;
            result?: unknown;
            error?: string;
        }>({ type: "trigger_action", name, payload });
        if (!result.success) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: result.error ?? "Action failed",
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text" as const,
                    text: result.result
                        ? `Action "${name}" executed.\nResult: ${JSON.stringify(result.result, null, 2)}`
                        : `Action "${name}" executed.`,
                },
            ],
        };
    } catch (e) {
        return {
            content: [
                { type: "text" as const, text: (e as Error).message },
            ],
            isError: true,
        };
    }
});

server.registerTool("get_logs", {
    description: "Get recent action execution logs with state diffs",
    annotations: { readOnlyHint: true },
}, async () => {
    try {
        const result = await sendAndWait<{
            data: ReadonlyArray<LogEntry>;
        }>({ type: "get_logs" });
        return {
            content: [
                { type: "text" as const, text: formatLogs(result.data) },
            ],
        };
    } catch (e) {
        return {
            content: [
                { type: "text" as const, text: (e as Error).message },
            ],
            isError: true,
        };
    }
});

server.registerTool("clear_logs", {
    description: "Clear all action execution logs",
    annotations: { destructiveHint: true },
}, async () => {
    try {
        await sendAndWait<{ success: boolean }>({ type: "clear_logs" });
        return {
            content: [
                { type: "text" as const, text: "Logs cleared." },
            ],
        };
    } catch (e) {
        return {
            content: [
                { type: "text" as const, text: (e as Error).message },
            ],
            isError: true,
        };
    }
});

// --- Start ---

const main = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("[mcp-devtools] MCP server running on stdio");
};

main().catch((e) => {
    console.error("[mcp-devtools] Fatal error:", e);
    process.exit(1);
});
