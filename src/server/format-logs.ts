// Formats log entries as readable plain text for MCP tool output

import type { LogEntry, StateDiff } from "../client/types";

const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-GB", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
};

const indent = (s: string, prefix: string): string =>
    s.split("\n").map((line) => prefix + line).join("\n");

const formatDiff = (diff: StateDiff): string => {
    const before = JSON.stringify(diff.before, null, 2);
    const after = JSON.stringify(diff.after, null, 2);
    return [
        `  [${diff.atom}]`,
        `    before:`,
        indent(before, "      "),
        `    after:`,
        indent(after, "      "),
    ].join("\n");
};

const formatEntry = (entry: LogEntry, index: number): string => {
    const time = formatTime(entry.timestamp);
    const header = `${index + 1}. ${entry.action}  (${time})`;
    if (entry.diffs.length === 0) {
        return `${header}\n  (no state changes)`;
    }
    return `${header}\n${entry.diffs.map(formatDiff).join("\n")}`;
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
    const changes = entry.diffs.map(summarizeDiff).filter(Boolean).join("; ");
    return `${entry.action} ${changes ? changes + " " : ""}(${time})`;
};

export const formatLogs = (logs: ReadonlyArray<LogEntry>): string => {
    if (logs.length === 0) return "No action logs recorded.";
    const last = logs[logs.length - 1]!;
    const summary = `${logs.length} ${logs.length === 1 ? "entry" : "entries"} | last: ${summarizeLast(last)}`;
    const separator = "=".repeat(summary.length);
    return `${summary}\n${separator}\n\n${logs.map(formatEntry).join("\n\n")}`;
};
