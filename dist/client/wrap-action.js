// Wraps an action function to capture before/after atom snapshots with nested tree support
import { getRegisteredAtoms, addLogEntry, pushExecutionContext, popExecutionContext, } from "./action-registry";
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
const buildEntry = (actionName, before, children) => {
    const after = snapshotAtoms();
    const entry = {
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
export const wrapAction = (name, fn) => {
    const wrapped = (...args) => {
        const before = snapshotAtoms();
        pushExecutionContext();
        const result = fn(...args);
        // Handle async actions
        if (result instanceof Promise) {
            return result.then((resolved) => {
                const children = popExecutionContext();
                addLogEntry(buildEntry(name, before, children));
                return resolved;
            }).catch((err) => {
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
    return wrapped;
};
//# sourceMappingURL=wrap-action.js.map