// MCP server (stdio) — gives Claude tools to inspect and drive the running app.
//
// It connects as a WebSocket client to the relay hosted by the dev server.
// stdout is the MCP protocol channel; all logging goes to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../shared/version.js";
import { BridgeClient } from "./bridge-client.js";
import * as ops from "./operations.js";

const client = new BridgeClient({
    log: (message) => console.error(`[Devtools Bridge] ${message}`),
});

const server = new McpServer(
    { name: "devtools-bridge", version: VERSION },
    {
        instructions:
            "Inspect and drive the state of a running web app (dev build). " +
            "Call `status` first: it lists the registered state containers, derived values and actions, " +
            "and explains what to fix if the dev server or the browser tab is not connected. " +
            "Read with `get_state` (use name/path instead of dumping everything), " +
            "change with `trigger_action` (preferred — runs the app's own logic) or `set_state`, " +
            "and use `get_logs` to see which action changed what.",
    },
);

type Shape = z.ZodRawShape;

interface ToolConfig<S extends Shape> {
    readonly description: string;
    readonly inputSchema: S;
    readonly annotations?: Record<string, boolean>;
}

type RegisterTool = (
    name: string,
    config: unknown,
    handler: (args: unknown) => Promise<unknown>,
) => unknown;

// The SDK's generic registerTool signature can exceed TypeScript's instantiation
// depth with larger schemas (TS2589), so arguments are typed here instead.
const tool = <S extends Shape>(
    name: string,
    config: ToolConfig<S>,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<ops.Outcome>,
): void => {
    (server.registerTool.bind(server) as unknown as RegisterTool)(name, config, async (args) => {
        try {
            const outcome = await run((args ?? {}) as z.infer<z.ZodObject<S>>);
            return {
                content: [{ type: "text", text: outcome.text }],
                ...(outcome.isError ? { isError: true } : {}),
            };
        } catch (err) {
            return {
                content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
                isError: true,
            };
        }
    });
};

const tab = z
    .string()
    .optional()
    .describe("Tab id from `status`. Default: the most recently focused tab.");

tool(
    "status",
    {
        description:
            "Connection status and inventory of the running app: connected browser tabs, registered state containers " +
            "(with size and top-level keys), derived values, action names and log size. Call this first, and whenever " +
            "another tool fails — it explains what is not connected and how to fix it.",
        inputSchema: { tab },
        annotations: { readOnlyHint: true },
    },
    (args) => ops.status(client, args.tab),
);

tool(
    "get_state",
    {
        description:
            "Read live state as JSON. Without arguments: all containers (shortened automatically if large). " +
            "With `name`: one container or derived value. With `name` + `path`: a value inside it, " +
            "e.g. path \"items[3].title\". Large results are shortened to fit `max_chars` and say so.",
        inputSchema: {
            name: z.string().optional().describe("State container or derived value name, as listed by `status`."),
            path: z.string().optional().describe("Path inside the container, e.g. \"user.settings\" or \"items[0]\". Requires `name`."),
            depth: z.number().int().min(0).optional().describe("Show only this many nesting levels; deeper objects and arrays are collapsed."),
            max_chars: z.number().int().min(200).optional().describe("Size budget for the result. Default 20000."),
            tab,
        },
        annotations: { readOnlyHint: true },
    },
    (args) => ops.getState(client, args),
);

tool(
    "set_state",
    {
        description:
            "Replace the value of a state container, or with `path` a single value inside it (the rest is kept). " +
            "Returns what changed. Prefer `trigger_action` when an action exists for the change — it runs the app's own logic.",
        inputSchema: {
            name: z.string().describe("State container name, as listed by `status`."),
            value: z
                .unknown()
                .describe("The new value as a JSON value (object, array, string, number, boolean or null) — not a JSON-encoded string."),
            path: z.string().optional().describe("Path inside the container, e.g. \"user.name\" or \"items[2].done\". Omit to replace the whole container."),
            tab,
        },
    },
    (args) => ops.setState(client, args as ops.SetStateArgs),
);

tool(
    "trigger_action",
    {
        description:
            "Invoke a registered action by name and wait for it (async actions are awaited). " +
            "Returns the action's result and the state changes it caused.",
        inputSchema: {
            name: z.string().describe("Action name, as listed by `status`."),
            args: z
                .array(z.unknown())
                .optional()
                .describe("Arguments passed to the action, as JSON values. Example: [{\"id\": 3}] calls action({id: 3})."),
            timeout_ms: z.number().int().min(100).optional().describe("How long to wait for the action. Default 10000."),
            tab,
        },
    },
    (args) => ops.triggerAction(client, args as ops.TriggerActionArgs),
);

tool(
    "get_logs",
    {
        description:
            "Recent action / effect / set_state log, newest last, with the state changes of each call as path-level diffs. " +
            "Returns the last `limit` entries; pass `since` (a sequence number from a previous call) to get only newer ones.",
        inputSchema: {
            limit: z.number().int().min(1).max(500).optional().describe("Maximum number of entries. Default 20."),
            since: z.number().int().min(0).optional().describe("Only entries with a sequence number greater than this."),
            name: z.string().optional().describe("Only entries whose action name contains this text."),
            verbose: z.boolean().optional().describe("Show longer values in diffs, args and results."),
            tab,
        },
        annotations: { readOnlyHint: true },
    },
    (args) => ops.getLogs(client, args),
);

tool(
    "clear_logs",
    {
        description: "Empty the action log buffer of the app.",
        inputSchema: { tab },
        annotations: { destructiveHint: true, idempotentHint: true },
    },
    (args) => ops.clearLogs(client, args.tab),
);

// Claude Code closes stdin when the session ends. The relay socket would
// otherwise keep this process alive.
const shutdown = (): void => {
    client.close();
    process.exit(0);
};
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);

const main = async (): Promise<void> => {
    await server.connect(new StdioServerTransport());
    console.error(`[Devtools Bridge] MCP server v${VERSION} running on stdio`);
};

main().catch((e) => {
    console.error("[Devtools Bridge] Fatal error:", e);
    process.exit(1);
});
