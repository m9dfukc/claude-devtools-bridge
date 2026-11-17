// Registry of state containers, derived state and actions, plus the action log.
const LOG_BUFFER_LIMIT = 500;
const atoms = new Map();
const derived = new Map();
const actions = new Map();
const logs = [];
let lastSeq = 0;
// --- Registration ---
//
// A disposer only removes the entry it created. After a re-registration under
// the same name (HMR) the old disposer is a no-op and returns false.
const disposer = (map, name, entry) => () => {
    if (map.get(name) !== entry)
        return false;
    return map.delete(name);
};
export const registerAtom = (name, atom, options) => {
    const entry = { atom, immutable: options?.immutable === true };
    atoms.set(name, entry);
    return disposer(atoms, name, entry);
};
export const unregisterAtom = (name) => atoms.delete(name);
export const getRegisteredAtoms = () => atoms;
export const registerDerived = (name, d) => {
    derived.set(name, d);
    return disposer(derived, name, d);
};
export const unregisterDerived = (name) => derived.delete(name);
export const getRegisteredDerived = () => derived;
export const registerAction = (name, fn) => {
    actions.set(name, fn);
    return disposer(actions, name, fn);
};
export const unregisterAction = (name) => actions.delete(name);
export const getRegisteredActions = () => actions;
let current = null;
const inFlight = new Set();
export const currentFrame = () => current;
export const inFlightNames = () => [...inFlight].map((f) => f.name);
export const openFrame = (name) => ({
    name,
    startedAt: Date.now(),
    children: [],
    during: inFlightNames(),
    open: true,
});
export const runInFrame = (frame, fn) => {
    const prev = current;
    current = frame;
    try {
        return fn();
    }
    finally {
        current = prev;
    }
};
export const markInFlight = (frame) => {
    inFlight.add(frame);
};
export const closeFrame = (frame) => {
    frame.open = false;
    inFlight.delete(frame);
};
export const getInFlight = () => [...inFlight].map((f) => ({ name: f.name, startedAt: f.startedAt }));
// --- Log ---
/**
 * Records a finished call. It becomes a child of `parent` if that call is
 * still running, otherwise a top-level entry with a sequence number.
 */
export const addLogEntry = (entry, parent = current, during = []) => {
    if (parent?.open) {
        parent.children.push(entry);
        return;
    }
    const top = {
        ...entry,
        seq: ++lastSeq,
        ...(during.length > 0 ? { during } : {}),
    };
    logs.push(top);
    if (logs.length > LOG_BUFFER_LIMIT) {
        logs.splice(0, logs.length - LOG_BUFFER_LIMIT);
    }
};
export const getLastSeq = () => lastSeq;
const mentions = (entry, needle) => entry.action.toLowerCase().includes(needle) ||
    (entry.children?.some((c) => mentions(c, needle)) ?? false);
export const queryLogs = (query = {}) => {
    const limit = Math.max(1, Math.min(query.limit ?? 20, LOG_BUFFER_LIMIT));
    const since = query.since ?? 0;
    const needle = query.name?.toLowerCase();
    const matching = logs.filter((e) => (e.seq ?? 0) > since && (needle === undefined || mentions(e, needle)));
    return {
        entries: matching.slice(-limit),
        total: logs.length,
        lastSeq,
        inFlight: getInFlight(),
    };
};
export const getLogs = () => logs;
export const clearLogs = () => {
    logs.length = 0;
};
/** Test helper: empties registry and log. Not part of the public API. */
export const resetRegistryForTests = () => {
    atoms.clear();
    derived.clear();
    actions.clear();
    logs.length = 0;
    lastSeq = 0;
    inFlight.clear();
    current = null;
};
