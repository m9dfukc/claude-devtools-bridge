// Request handlers — the single implementation behind the WebSocket client
// and the `window.__DEVTOOLS_BRIDGE__` fallback.

import {
    PROTOCOL_VERSION,
    type ActionResult,
    type BrowserRequestType,
    type ContainerInfo,
    type Description,
    type ErrorCode,
    type GetStateResult,
    type LogsResult,
    type SetStateResult,
} from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import {
    addLogEntry,
    clearLogs,
    getInFlight,
    getLastSeq,
    getLogs,
    getRegisteredActions,
    getRegisteredAtoms,
    getRegisteredDerived,
    queryLogs,
} from "./action-registry.js";
import { diffValues } from "./diff.js";
import { getIn, parsePath, setIn } from "./path.js";
import { safeSerializeValue } from "./safe-serialize.js";
import { cloneValue, diffSnapshots, snapshotAtoms } from "./snapshot.js";
import { fitToBudget, summarize } from "./summarize.js";

const DEFAULT_MAX_CHARS = 20_000;

export class HandlerError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
    ) {
        super(message);
    }
}

const typeOf = (v: unknown): string =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

const list = (names: Iterable<string>): string => {
    const all = [...names];
    return all.length > 0 ? all.join(", ") : "(none registered)";
};

const asInt = (v: unknown, name: string): number | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new HandlerError("bad_request", `"${name}" must be a number`);
    }
    return Math.floor(v);
};

const asString = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string") {
        throw new HandlerError("bad_request", `"${name}" must be a string`);
    }
    return v;
};

const readPlain = (deref: () => unknown): unknown => {
    try {
        return safeSerializeValue(deref());
    } catch (err) {
        return { $error: `deref() threw: ${String(err)}` };
    }
};

const containerInfo = (name: string, deref: () => unknown, immutable?: boolean): ContainerInfo => {
    let value: unknown;
    try {
        value = safeSerializeValue(deref());
    } catch (err) {
        return { name, type: "error", size: 0, error: String(err) };
    }
    const type = typeOf(value);
    return {
        name,
        type,
        size: (JSON.stringify(value) ?? "").length,
        ...(type === "object"
            ? { keys: Object.keys(value as object).slice(0, 30) }
            : {}),
        ...(type === "array" ? { length: (value as unknown[]).length } : {}),
        ...(immutable ? { immutable } : {}),
    };
};

// --- describe ---

export const describe = (): Description => {
    const loc = (globalThis as { location?: { href?: string } }).location;
    const doc = (globalThis as { document?: { title?: string } }).document;
    return {
        version: VERSION,
        protocol: PROTOCOL_VERSION,
        ...(loc?.href ? { url: loc.href } : {}),
        ...(doc?.title ? { title: doc.title } : {}),
        atoms: [...getRegisteredAtoms()].map(([name, e]) =>
            containerInfo(name, () => e.atom.deref(), e.immutable),
        ),
        derived: [...getRegisteredDerived()].map(([name, d]) =>
            containerInfo(name, () => d.deref()),
        ),
        actions: [...getRegisteredActions().keys()],
        logs: { count: getLogs().length, lastSeq: getLastSeq() },
        inFlight: getInFlight(),
    };
};

// --- get_state ---

export interface GetStateParams {
    readonly name?: string;
    readonly path?: string;
    readonly depth?: number;
    readonly maxChars?: number;
}

const allState = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, { atom }] of getRegisteredAtoms()) {
        out[name] = readPlain(() => atom.deref());
    }
    const derived = getRegisteredDerived();
    if (derived.size === 0) return out;
    const d: Record<string, unknown> = {};
    for (const [name, entry] of derived) d[name] = readPlain(() => entry.deref());
    return { ...out, $derived: d };
};

export const getState = (params: GetStateParams = {}): GetStateResult => {
    const name = asString(params.name, "name");
    const path = asString(params.path, "path");
    const depth = asInt(params.depth, "depth");
    const maxChars = Math.max(200, asInt(params.maxChars, "max_chars") ?? DEFAULT_MAX_CHARS);

    let value: unknown;
    if (name === undefined) {
        if (path !== undefined) {
            throw new HandlerError("bad_request", `"path" needs "name" — which container should it be applied to?`);
        }
        value = allState();
    } else {
        const atom = getRegisteredAtoms().get(name);
        const derived = getRegisteredDerived().get(name);
        if (!atom && !derived) {
            throw new HandlerError(
                "not_found",
                `Unknown state container "${name}". Atoms: ${list(getRegisteredAtoms().keys())}. Derived: ${list(getRegisteredDerived().keys())}`,
            );
        }
        try {
            value = safeSerializeValue(atom ? atom.atom.deref() : derived!.deref());
        } catch (err) {
            throw new HandlerError("handler_error", `deref() of "${name}" threw: ${String(err)}`);
        }
        if (path !== undefined) {
            try {
                value = getIn(value, parsePath(path));
            } catch (err) {
                throw new HandlerError("not_found", `${name}: ${(err as Error).message}`);
            }
        }
    }

    if (depth !== undefined) {
        value = summarize(value, { depth: Math.max(0, depth), maxItems: Infinity, maxString: Infinity });
    }
    const fitted = fitToBudget(value, maxChars);
    return {
        value: fitted.value,
        ...(fitted.truncated
            ? { truncated: `${fitted.truncated}. Narrow it with name/path, or raise max_chars.` }
            : {}),
    };
};

// --- set_state ---

export interface SetStateParams {
    readonly name?: string;
    readonly path?: string;
    readonly value?: unknown;
}

export const setState = (params: SetStateParams): SetStateResult => {
    const name = asString(params.name, "name");
    const path = asString(params.path, "path");
    if (name === undefined) throw new HandlerError("bad_request", `"name" is required`);
    if (params.value === undefined) {
        throw new HandlerError("bad_request", `"value" is required (use null to set JSON null)`);
    }
    if (getRegisteredDerived().has(name)) {
        throw new HandlerError("read_only", `"${name}" is a derived (read-only) value and cannot be set directly.`);
    }
    const entry = getRegisteredAtoms().get(name);
    if (!entry) {
        throw new HandlerError("not_found", `Unknown atom "${name}". Available: ${list(getRegisteredAtoms().keys())}`);
    }

    const startedAt = Date.now();
    let before: unknown;
    let target: unknown;
    let next: unknown;
    try {
        const live = entry.atom.deref();
        before = entry.immutable ? live : cloneValue(live);
        const tokens = path !== undefined ? parsePath(path) : [];
        target = tokens.length > 0 ? safeGet(before, tokens) : before;
        next = tokens.length > 0 ? setIn(live, tokens, params.value) : params.value;
    } catch (err) {
        throw new HandlerError("not_found", `${name}: ${(err as Error).message}`);
    }
    try {
        entry.atom.reset(next);
    } catch (err) {
        throw new HandlerError("handler_error", `reset() of "${name}" threw: ${String(err)}`);
    }

    const { changes, truncated } = diffValues(before, entry.atom.deref());
    addLogEntry(
        {
            action: path !== undefined ? `set_state ${name} @ ${path}` : `set_state ${name}`,
            kind: "set_state",
            timestamp: startedAt,
            diffs: changes.length > 0 ? [{ atom: name, changes, ...(truncated ? { truncated } : {}) }] : [],
        },
        null,
    );
    return {
        changes,
        ...(truncated ? { truncated } : {}),
        previousType: typeOf(target),
        newType: typeOf(params.value),
    };
};

const safeGet = (root: unknown, tokens: ReadonlyArray<string | number>): unknown => {
    try {
        return getIn(root, tokens);
    } catch {
        return undefined; // new key / appended index
    }
};

// --- trigger_action ---

export interface TriggerActionParams {
    readonly name?: string;
    readonly args?: unknown;
    readonly maxChars?: number;
}

export const triggerAction = async (params: TriggerActionParams): Promise<ActionResult> => {
    const name = asString(params.name, "name");
    if (name === undefined) throw new HandlerError("bad_request", `"name" is required`);
    const args = params.args ?? [];
    if (!Array.isArray(args)) {
        throw new HandlerError("bad_request", `"args" must be an array of arguments, e.g. [{"id": 1}]`);
    }
    const action = getRegisteredActions().get(name);
    if (!action) {
        throw new HandlerError("not_found", `Unknown action "${name}". Available: ${list(getRegisteredActions().keys())}`);
    }
    const maxChars = Math.max(200, asInt(params.maxChars, "max_chars") ?? DEFAULT_MAX_CHARS);

    const seqBefore = getLastSeq();
    const before = snapshotAtoms();
    const t0 = Date.now();
    let result: unknown;
    let error: string | undefined;
    try {
        result = await action(...args);
    } catch (err) {
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    const duration = Date.now() - t0;
    const fitted = fitToBudget(safeSerializeValue(result), maxChars);

    return {
        ...(result !== undefined ? { result: fitted.value } : {}),
        ...(fitted.truncated ? { resultTruncated: fitted.truncated } : {}),
        ...(error !== undefined ? { error } : {}),
        duration,
        diffs: diffSnapshots(before, snapshotAtoms()),
        logs: queryLogs({ since: seqBefore, limit: 10 }).entries,
    };
};

// --- get_logs / clear_logs ---

export interface GetLogsParams {
    readonly limit?: number;
    readonly since?: number;
    readonly name?: string;
}

export const getLogEntries = (params: GetLogsParams = {}): LogsResult => {
    const limit = asInt(params.limit, "limit");
    const since = asInt(params.since, "since");
    const name = asString(params.name, "name");
    return queryLogs({
        ...(limit !== undefined ? { limit } : {}),
        ...(since !== undefined ? { since } : {}),
        ...(name !== undefined ? { name } : {}),
    });
};

export const clearLogEntries = (): { cleared: number } => {
    const cleared = getLogs().length;
    clearLogs();
    return { cleared };
};

// --- dispatch ---

export const handleRequest = async (
    type: BrowserRequestType | string,
    params: Record<string, unknown> = {},
): Promise<unknown> => {
    switch (type) {
        case "describe":
            return describe();
        case "get_state":
            return getState(params);
        case "set_state":
            return setState(params);
        case "trigger_action":
            return triggerAction(params);
        case "get_logs":
            return getLogEntries(params);
        case "clear_logs":
            return clearLogEntries();
        default:
            throw new HandlerError(
                "bad_request",
                `Unknown request type "${type}" — the browser client (v${VERSION}) is older than the MCP server. Update the claude-devtools-bridge dependency of the app.`,
            );
    }
};
