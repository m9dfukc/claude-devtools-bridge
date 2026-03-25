// Wraps an action function to capture before/after atom snapshots with nested tree support

import {
    getRegisteredAtoms,
    addLogEntry,
    pushExecutionContext,
    popExecutionContext,
} from "./action-registry";
import type { ActionFn, LogEntry, StateDiff } from "./types";

const snapshotAtoms = (): Map<string, unknown> => {
    const snap = new Map<string, unknown>();
    for (const [name, atom] of getRegisteredAtoms()) {
        try {
            snap.set(name, structuredClone(atom.deref()));
        } catch {
            snap.set(name, JSON.parse(JSON.stringify(atom.deref())));
        }
    }
    return snap;
};

const computeDiffs = (
    before: Map<string, unknown>,
    after: Map<string, unknown>,
): ReadonlyArray<StateDiff> => {
    const diffs: StateDiff[] = [];
    for (const [name, beforeVal] of before) {
        const afterVal = after.get(name);
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
            diffs.push({ atom: name, before: beforeVal, after: afterVal });
        }
    }
    return diffs;
};

const buildEntry = (
    actionName: string,
    before: Map<string, unknown>,
    children: ReadonlyArray<LogEntry>,
): LogEntry => {
    const after = snapshotAtoms();
    const entry: LogEntry = {
        action: actionName,
        timestamp: Date.now(),
        kind: "action",
        diffs: computeDiffs(before, after),
    };
    if (children.length > 0) {
        return { ...entry, children };
    }
    return entry;
};

export const wrapAction = <F extends ActionFn>(name: string, fn: F): F => {
    const wrapped = (...args: readonly unknown[]): unknown => {
        const before = snapshotAtoms();
        pushExecutionContext();

        const result = fn(...args);

        // Handle async actions
        if (result instanceof Promise) {
            return result.then((resolved) => {
                const children = popExecutionContext();
                addLogEntry(buildEntry(name, before, children));
                return resolved;
            }).catch((err: unknown) => {
                const children = popExecutionContext();
                addLogEntry({
                    ...buildEntry(name, before, children),
                    error: String(err),
                });
                throw err;
            });
        }

        const children = popExecutionContext();
        addLogEntry(buildEntry(name, before, children));
        return result;
    };
    return wrapped as F;
};
