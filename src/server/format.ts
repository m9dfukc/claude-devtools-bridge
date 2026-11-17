// Plain-text rendering of bridge results for MCP tool output and the CLI.

import type {
    ActionResult,
    Change,
    ContainerInfo,
    Description,
    GetStateResult,
    LogEntry,
    LogsResult,
    RelayStatus,
    SetStateResult,
    StateDiff,
} from "../shared/protocol.js";

const pad = (n: number, len = 2): string => String(n).padStart(len, "0");

export const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

const ago = (ts: number, now = Date.now()): string => {
    const s = Math.max(0, (now - ts) / 1000);
    if (s < 60) return `${s.toFixed(1)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Compact single-line JSON, cut at `max` characters. */
export const inline = (value: unknown, max: number): string => {
    const s = JSON.stringify(value) ?? "undefined";
    return s.length > max ? `${s.slice(0, max)}… (+${s.length - max} chars)` : s;
};

const indent = (text: string, prefix: string): string =>
    text
        .split("\n")
        .map((line) => prefix + line)
        .join("\n");

// --- Changes ---

const formatChange = (c: Change, max: number): string => {
    const path = c.path || "(root)";
    if (c.count !== undefined) {
        return c.op === "add"
            ? `+ ${path}: ${c.count} items added, first: ${inline(c.after, max)}`
            : `- ${path}: ${c.count} items removed, first was: ${inline(c.before, max)}`;
    }
    switch (c.op) {
        case "add":
            return `+ ${path}: ${inline(c.after, max)}`;
        case "remove":
            return `- ${path} (was ${inline(c.before, max)})`;
        default:
            return `${path}: ${inline(c.before, max)} → ${inline(c.after, max)}`;
    }
};

export const formatDiffs = (diffs: ReadonlyArray<StateDiff>, max: number): string =>
    diffs
        .map((d) => {
            const lines = d.changes.map((c) => `  ${formatChange(c, max)}`);
            if (d.truncated) lines.push("  … more changes not listed");
            return `[${d.atom}]\n${lines.join("\n")}`;
        })
        .join("\n");

// --- Logs ---

const KIND_MARK: Record<LogEntry["kind"], string> = { action: "", effect: "⚡ ", set_state: "✎ " };

const formatEntry = (entry: LogEntry, max: number): string => {
    const head = [
        entry.seq !== undefined ? `#${entry.seq}` : "↳",
        `${KIND_MARK[entry.kind] ?? ""}${entry.action}`,
        `(${formatTime(entry.timestamp)}`,
    ];
    const meta: string[] = [];
    if (entry.duration !== undefined) meta.push(`${entry.duration}ms`);
    if (entry.async) meta.push("async");
    const lines = [`${head.join(" ")}${meta.length > 0 ? `, ${meta.join(", ")}` : ""})`];

    if (entry.args !== undefined) lines.push(`  args: ${inline(entry.args, max)}`);
    if (entry.during && entry.during.length > 0) {
        lines.push(`  started while in flight: ${entry.during.join(", ")}`);
    }
    if (entry.kind !== "effect") {
        if (entry.diffs.length > 0) {
            lines.push(indent(formatDiffs(entry.diffs, max), "  "));
            if (entry.async) {
                lines.push("  (async: the diff covers everything that changed until it settled)");
            }
        } else if (!entry.children?.length) {
            lines.push("  (no state changes)");
        }
    }
    if (entry.error !== undefined) lines.push(`  error: ${entry.error}`);
    else if (entry.result !== undefined) lines.push(`  result: ${inline(entry.result, max)}`);
    for (const child of entry.children ?? []) {
        lines.push(indent(formatEntry(child, max), "  "));
    }
    return lines.join("\n");
};

export const formatLogs = (result: LogsResult, verbose = false): string => {
    const max = verbose ? 2000 : 160;
    const inFlight =
        result.inFlight.length > 0
            ? `\n\nIn flight (async, not finished): ${result.inFlight
                  .map((f) => `${f.name} (running ${ago(f.startedAt)})`)
                  .join(", ")}`
            : "";
    if (result.entries.length === 0) {
        const why = result.total === 0 ? "No log entries recorded." : "No log entries match.";
        return `${why} (${result.total} in buffer, last seq ${result.lastSeq})${inFlight}`;
    }
    const first = result.entries[0]!.seq;
    const last = result.entries[result.entries.length - 1]!.seq;
    const header =
        `${result.entries.length} ${result.entries.length === 1 ? "entry" : "entries"} ` +
        `(#${first}–#${last}; ${result.total} in buffer). ` +
        `Pass since: ${result.lastSeq} to get only newer entries.`;
    return `${header}\n\n${result.entries.map((e) => formatEntry(e, max)).join("\n\n")}${inFlight}`;
};

// --- State ---

export const formatState = (result: GetStateResult): string => {
    const json = JSON.stringify(result.value, null, 2) ?? "null";
    return result.truncated ? `${json}\n\n(Shortened — ${result.truncated})` : json;
};

export const formatSetResult = (name: string, path: string | undefined, result: SetStateResult): string => {
    const target = path ? `"${name}" at ${path}` : `"${name}"`;
    const lines = [`Set ${target} (${result.newType}).`];
    if (
        result.previousType !== result.newType &&
        result.previousType !== "undefined" &&
        result.previousType !== "null"
    ) {
        lines.push(
            `Warning: the type changed from ${result.previousType} to ${result.newType}.` +
                (result.newType === "string"
                    ? " If you meant an object or array, pass it as a JSON value, not as a JSON-encoded string."
                    : ""),
        );
    }
    if (result.changes.length === 0) {
        lines.push("No difference to the previous value.");
    } else {
        lines.push(formatDiffs([{ atom: name, changes: result.changes, ...(result.truncated ? { truncated: true } : {}) }], 160));
    }
    return lines.join("\n");
};

export const formatActionResult = (name: string, result: ActionResult): string => {
    const lines = [
        result.error !== undefined
            ? `Action "${name}" threw after ${result.duration}ms: ${result.error}`
            : `Action "${name}" executed (${result.duration}ms).`,
    ];
    if (result.result !== undefined) {
        lines.push(`Result:\n${JSON.stringify(result.result, null, 2)}`);
        if (result.resultTruncated) lines.push(`(Result shortened — ${result.resultTruncated})`);
    }
    lines.push(
        result.diffs.length > 0
            ? `State changes:\n${formatDiffs(result.diffs, 160)}`
            : "State changes: none.",
    );
    if (result.logs.length > 0) {
        const names = result.logs.map((e) => `#${e.seq} ${e.action}${e.error !== undefined ? " (error)" : ""}`);
        lines.push(`Logged: ${names.join(", ")} — details via get_logs.`);
    }
    return lines.join("\n");
};

// --- Status ---

const formatContainer = (c: ContainerInfo): string => {
    if (c.error !== undefined) return `  ${c.name} — deref() threw: ${c.error}`;
    const shape =
        c.type === "object"
            ? `object {${(c.keys ?? []).join(", ")}${(c.keys?.length ?? 0) >= 30 ? ", …" : ""}}`
            : c.type === "array"
              ? `array (${c.length} items)`
              : c.type;
    return `  ${c.name} — ${shape}, ~${c.size} chars${c.immutable ? ", immutable" : ""}`;
};

export const formatStatus = (
    connection: string,
    relay: RelayStatus,
    description: Description | undefined,
    descriptionError: string | undefined,
    serverVersion: string,
): string => {
    const lines = [connection, `Relay v${relay.version}, MCP server v${serverVersion}.`];
    if (relay.version !== serverVersion) {
        lines.push(
            `Note: the relay (npm dependency of the app) and the MCP server (plugin) are on different versions — keep them in sync.`,
        );
    }

    if (relay.tabs.length === 0) {
        lines.push(
            "",
            "No browser tab is connected. Open the app in a browser (dev build) and make sure initDevtools() / connectDevtools() runs.",
        );
        if (relay.outdatedBrowserSeenAt !== undefined && Date.now() - relay.outdatedBrowserSeenAt < 10_000) {
            lines.push(
                "A tab with an outdated claude-devtools-bridge client keeps trying to connect — update the npm dependency of the app and reload the page.",
            );
        }
        return lines.join("\n");
    }

    lines.push("", `Browser tabs (${relay.tabs.length}):`);
    for (const tab of relay.tabs) {
        const label = [tab.title, tab.url].filter(Boolean).join(" — ") || "(no page info)";
        lines.push(`  ${tab.active ? "→" : " "} ${tab.id}  ${label}  (client v${tab.version ?? "?"}, connected ${ago(tab.connectedAt)} ago)`);
    }
    if (relay.tabs.length > 1) {
        lines.push("  → marks the tab that answers by default (most recently focused). Pass tab: \"<id>\" to address another one.");
    }

    if (!description) {
        lines.push("", `The tab did not answer: ${descriptionError ?? "unknown error"}`);
        return lines.join("\n");
    }

    lines.push("", `State containers (${description.atoms.length}):`);
    lines.push(...(description.atoms.length > 0 ? description.atoms.map(formatContainer) : ["  (none registered)"]));
    if (description.derived.length > 0) {
        lines.push("", `Derived, read-only (${description.derived.length}):`, ...description.derived.map(formatContainer));
    }
    lines.push(
        "",
        `Actions (${description.actions.length}):`,
        description.actions.length > 0 ? `  ${description.actions.join(", ")}` : "  (none registered)",
    );
    lines.push("", `Log: ${description.logs.count} entries in buffer, last seq ${description.logs.lastSeq}.`);
    if (description.inFlight.length > 0) {
        lines.push(
            `In flight (async, not finished): ${description.inFlight
                .map((f) => `${f.name} (running ${ago(f.startedAt)})`)
                .join(", ")}`,
        );
    }
    return lines.join("\n");
};
