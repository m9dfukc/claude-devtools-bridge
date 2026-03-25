// Formats log entries as readable plain text for MCP tool output

import type { LogEntry, StateDiff } from "../client/types";

const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-GB", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
};

const indent = (s: string, prefix: string): string =>
    s.split("\n").map((line) => prefix + line).join("\n");

const formatDiff = (diff: StateDiff, baseIndent: string): string => {
    const before = JSON.stringify(diff.before, null, 2);
    const after = JSON.stringify(diff.after, null, 2);
    return [
        `${baseIndent}  [${diff.atom}]`,
        `${baseIndent}    before:`,
        indent(before, `${baseIndent}      `),
        `${baseIndent}    after:`,
        indent(after, `${baseIndent}      `),
    ].join("\n");
};

const formatEffect = (entry: LogEntry, index: number, baseIndent: string): string => {
    const time = formatTime(entry.timestamp);
    const duration = entry.duration !== undefined ? ` ${entry.duration}ms` : "";
    const header = `${baseIndent}${index + 1}. ⚡ ${entry.action}${duration}  (${time})`;
    const lines = [header];
    if (entry.args !== undefined) {
        lines.push(`${baseIndent}  args: ${JSON.stringify(entry.args)}`);
    }
    if (entry.error !== undefined) {
        lines.push(`${baseIndent}  error: ${entry.error}`);
    } else if (entry.result !== undefined) {
        lines.push(`${baseIndent}  result: ${JSON.stringify(entry.result)}`);
    }
    return lines.join("\n");
};

const formatEntry = (entry: LogEntry, index: number, depth = 0): string => {
    const baseIndent = "  ".repeat(depth);
    const time = formatTime(entry.timestamp);

    // Effect entries
    if (entry.kind === "effect") {
        return formatEffect(entry, index, baseIndent);
    }

    // Action entries
    const header = `${baseIndent}${index + 1}. ${entry.action}  (${time})`;
    const parts = [header];

    if (entry.diffs.length === 0 && (!entry.children || entry.children.length === 0)) {
        parts.push(`${baseIndent}  (no state changes)`);
    } else {
        if (entry.diffs.length > 0) {
            parts.push(entry.diffs.map((d) => formatDiff(d, baseIndent)).join("\n"));
        }
    }

    if (entry.error !== undefined) {
        parts.push(`${baseIndent}  error: ${entry.error}`);
    }

    // Render children (nested actions/effects)
    if (entry.children && entry.children.length > 0) {
        parts.push(`${baseIndent}  children:`);
        for (let i = 0; i < entry.children.length; i++) {
            parts.push(formatEntry(entry.children[i]!, i, depth + 2));
        }
    }

    return parts.join("\n");
};

const changedKeys = (before: unknown, after: unknown): string[] => {
    if (typeof before !== "object" || typeof after !== "object" || !before || !after) return [];
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    return Object.keys(b).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
};

const summarizeDiff = (diff: StateDiff): string => {
    const keys = changedKeys(diff.before, diff.after);
    if (keys.length === 0 && diff.before !== diff.after) {
        return `${diff.atom}: ${String(diff.before)}→${String(diff.after)}`;
    }
    const b = diff.before as Record<string, unknown>;
    const a = diff.after as Record<string, unknown>;
    const parts = keys.slice(0, 3).map((k) => `${k}: ${String(b[k])}→${String(a[k])}`);
    return parts.length > 0 ? parts.join(", ") : "";
};

const summarizeLast = (entry: LogEntry): string => {
    const time = formatTime(entry.timestamp);
    const kind = entry.kind === "effect" ? "⚡ " : "";
    const changes = entry.diffs.map(summarizeDiff).filter(Boolean).join("; ");
    const childCount = entry.children?.length ?? 0;
    const childInfo = childCount > 0 ? ` [${childCount} nested]` : "";
    return `${kind}${entry.action} ${changes ? changes + " " : ""}${childInfo}(${time})`;
};

export const formatLogs = (logs: ReadonlyArray<LogEntry>): string => {
    if (logs.length === 0) return "No action logs recorded.";
    const last = logs[logs.length - 1]!;
    const summary = `${logs.length} ${logs.length === 1 ? "entry" : "entries"} | last: ${summarizeLast(last)}`;
    const separator = "=".repeat(summary.length);
    return `${summary}\n${separator}\n\n${logs.map((e, i) => formatEntry(e, i)).join("\n\n")}`;
};
