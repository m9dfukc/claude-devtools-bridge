// Wraps an action function to capture before/after atom snapshots
import { getRegisteredAtoms, addLogEntry } from "./action-registry";
const snapshotAtoms = () => {
    const snap = new Map();
    for (const [name, atom] of getRegisteredAtoms()) {
        try {
            snap.set(name, structuredClone(atom.deref()));
        }
        catch {
            snap.set(name, JSON.parse(JSON.stringify(atom.deref())));
        }
    }
    return snap;
};
const computeDiffs = (before, after) => {
    const diffs = [];
    for (const [name, beforeVal] of before) {
        const afterVal = after.get(name);
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
            diffs.push({ atom: name, before: beforeVal, after: afterVal });
        }
    }
    return diffs;
};
const logExecution = (actionName, before) => {
    const after = snapshotAtoms();
    addLogEntry({
        action: actionName,
        timestamp: Date.now(),
        diffs: computeDiffs(before, after),
    });
};
export const wrapAction = (name, fn) => {
    const wrapped = (...args) => {
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
    return wrapped;
};
//# sourceMappingURL=wrap-action.js.map