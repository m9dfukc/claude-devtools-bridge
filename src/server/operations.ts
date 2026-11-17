// The operations behind both the MCP tools and the CLI. Each returns the
// text to show; failures throw BridgeError with an actionable message.

import type {
    ActionResult,
    Description,
    GetStateResult,
    LogsResult,
    RelayStatus,
    SetStateResult,
} from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import { BridgeError, type BridgeClient } from "./bridge-client.js";
import { formatActionResult, formatLogs, formatSetResult, formatState, formatStatus } from "./format.js";

export interface Outcome {
    readonly text: string;
    readonly isError?: boolean;
}

const defined = (obj: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

export const status = async (client: BridgeClient, tab?: string): Promise<Outcome> => {
    const state = await client.connect();
    if (state.kind !== "connected") {
        return { text: client.explain(state), isError: true };
    }
    // Ask the tab first: answering makes it report a changed URL / title to
    // the relay, so the tab list fetched afterwards is current.
    let description: Description | undefined;
    let descriptionError: string | undefined;
    try {
        description = await client.request<Description>("describe", {}, { ...(tab ? { tab } : {}) });
    } catch (err) {
        descriptionError = (err as Error).message;
    }
    const relay = await client.request<RelayStatus>("relay_status");
    return { text: formatStatus(client.explain(state), relay, description, descriptionError, VERSION) };
};

export interface GetStateArgs {
    readonly name?: string | undefined;
    readonly path?: string | undefined;
    readonly depth?: number | undefined;
    readonly max_chars?: number | undefined;
    readonly tab?: string | undefined;
}

export const getState = async (client: BridgeClient, args: GetStateArgs): Promise<Outcome> => {
    const result = await client.request<GetStateResult>(
        "get_state",
        defined({ name: args.name, path: args.path, depth: args.depth, maxChars: args.max_chars }),
        { ...(args.tab ? { tab: args.tab } : {}) },
    );
    return { text: formatState(result) };
};

export interface SetStateArgs {
    readonly name: string;
    readonly value?: unknown;
    readonly path?: string | undefined;
    readonly tab?: string | undefined;
}

export const setState = async (client: BridgeClient, args: SetStateArgs): Promise<Outcome> => {
    if (args.value === undefined) {
        throw new BridgeError("bad_request", `"value" is required (use null to set JSON null).`);
    }
    const result = await client.request<SetStateResult>(
        "set_state",
        defined({ name: args.name, path: args.path, value: args.value }) as Record<string, unknown> & { value: unknown },
        { ...(args.tab ? { tab: args.tab } : {}) },
    );
    return { text: formatSetResult(args.name, args.path ?? undefined, result) };
};

export interface TriggerActionArgs {
    readonly name: string;
    readonly args?: ReadonlyArray<unknown> | undefined;
    readonly timeout_ms?: number | undefined;
    readonly tab?: string | undefined;
}

export const triggerAction = async (client: BridgeClient, args: TriggerActionArgs): Promise<Outcome> => {
    const result = await client.request<ActionResult>(
        "trigger_action",
        defined({ name: args.name, args: args.args }),
        {
            ...(args.tab ? { tab: args.tab } : {}),
            ...(args.timeout_ms ? { timeoutMs: Math.min(Math.max(args.timeout_ms, 100), 600_000) } : {}),
        },
    );
    return { text: formatActionResult(args.name, result), ...(result.error !== undefined ? { isError: true } : {}) };
};

export interface GetLogsArgs {
    readonly limit?: number | undefined;
    readonly since?: number | undefined;
    readonly name?: string | undefined;
    readonly verbose?: boolean | undefined;
    readonly tab?: string | undefined;
}

export const getLogs = async (client: BridgeClient, args: GetLogsArgs): Promise<Outcome> => {
    const result = await client.request<LogsResult>(
        "get_logs",
        defined({ limit: args.limit, since: args.since, name: args.name }),
        { ...(args.tab ? { tab: args.tab } : {}) },
    );
    return { text: formatLogs(result, args.verbose === true) };
};

export const clearLogs = async (client: BridgeClient, tab?: string): Promise<Outcome> => {
    const result = await client.request<{ cleared: number }>("clear_logs", {}, { ...(tab ? { tab } : {}) });
    return { text: `Logs cleared (${result.cleared} ${result.cleared === 1 ? "entry" : "entries"} removed).` };
};
