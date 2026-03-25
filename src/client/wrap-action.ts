// Wraps an action function to capture before/after atom snapshots

import { getRegisteredAtoms, addLogEntry } from "./action-registry";
import type { ActionFn, StateDiff } from "./types";

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

const logExecution = (
    actionName: string,
    before: Map<string, unknown>,
): void => {
    const after = snapshotAtoms();
    addLogEntry({
        action: actionName,
        timestamp: Date.now(),
        diffs: computeDiffs(before, after),
    });
};

export const wrapAction = <F extends ActionFn>(name: string, fn: F): F => {
    const wrapped = (...args: readonly unknown[]): unknown => {
        const before = snapshotAtoms();
        const result = fn(...args);

        // Handle async actions
        if (result instanceof Promise) {
            return result.then((resolved) => {
                logExecution(name, before);
                return resolved;
            });
        }

        logExecution(name, before);
        return result;
    };
    return wrapped as F;
};
