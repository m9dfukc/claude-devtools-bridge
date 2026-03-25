// Standalone Node MCP server — bridges Claude ↔ browser via WebSocket

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { formatLogs } from "./format-logs";
import type { ClientMessage, LogEntry } from "../client/types";

const TIMEOUT_MS = 10_000;
const PORT = parseInt(process.env["DEVTOOLS_PORT"] ?? "7777", 10);

// --- WebSocket state ---

let browserClient: WebSocket | null = null;
const pending = new Map<
    string,
    { resolve: (data: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();

let nextId = 0;
const genId = (): string => `req_${++nextId}_${Date.now()}`;

// --- WebSocket server ---

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

const bindConnection = (wss: InstanceType<typeof WebSocketServer>): void => {
    wss.on("connection", (ws) => {
        console.error("[mcp-devtools] browser client connected");
        browserClient = ws;

        ws.on("message", (raw) => {
            const msg = JSON.parse(raw.toString()) as ClientMessage;
            const entry = pending.get(msg.id);
            if (entry) {
                clearTimeout(entry.timer);
                pending.delete(msg.id);
                entry.resolve(msg);
            }
        });

        ws.on("close", () => {
            console.error("[mcp-devtools] browser client disconnected");
            if (browserClient === ws) browserClient = null;
        });
    });
};

const startWebSocket = (attempt = 1): void => {
    const wss = new WebSocketServer({ port: PORT });

    wss.on("listening", () => {
        console.error(`[mcp-devtools] WebSocket server listening on port ${PORT}`);
    });

    wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < MAX_RETRIES) {
            console.error(
                `[mcp-devtools] Port ${PORT} in use — retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS}ms...`,
            );
            wss.close();
            setTimeout(() => startWebSocket(attempt + 1), RETRY_DELAY_MS);
        } else {
            // EPERM (sandbox), EACCES, or exhausted retries — log but don't crash.
            // The MCP stdio server stays alive; WebSocket features are unavailable.
            console.error(
                `[mcp-devtools] WebSocket server failed (${err.code ?? "unknown"}): ${err.message}. ` +
                    "MCP tools still available via stdio, but browser bridge is disabled.",
            );
        }
    });

    bindConnection(wss);
};

startWebSocket();

// --- Helpers ---

const sendAndWait = <T>(message: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
        if (!browserClient || browserClient.readyState !== WebSocket.OPEN) {
            reject(
                new Error(
                    "No browser client connected. Start the app dev server first.",
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

        browserClient.send(JSON.stringify(msg));
    });

// --- MCP server ---

const server = new McpServer({
    name: "app-devtools",
    version: "0.1.0",
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

const main = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-devtools] MCP server running on stdio");
};

main().catch((e) => {
    console.error("[mcp-devtools] Fatal error:", e);
    process.exit(1);
});
