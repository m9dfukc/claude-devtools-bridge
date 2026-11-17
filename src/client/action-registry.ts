// Registry of state containers, derived state and actions, plus the action log.

import type { InFlightInfo, LogEntry, LogsResult } from "../shared/protocol.js";
import type { ActionFn, AtomOptions, Derivable, DisposeFn, Watchable } from "./types.js";

const LOG_BUFFER_LIMIT = 500;

export interface AtomEntry {
    readonly atom: Watchable;
    readonly immutable: boolean;
}

const atoms = new Map<string, AtomEntry>();
const derived = new Map<string, Derivable>();
const actions = new Map<string, ActionFn>();
const logs: LogEntry[] = [];
let lastSeq = 0;

// --- Registration ---
//
// A disposer only removes the entry it created. After a re-registration under
// the same name (HMR) the old disposer is a no-op and returns false.

const disposer = <T>(map: Map<string, T>, name: string, entry: T): DisposeFn => () => {
    if (map.get(name) !== entry) return false;
    return map.delete(name);
};

export const registerAtom = (name: string, atom: Watchable, options?: AtomOptions): DisposeFn => {
    const entry: AtomEntry = { atom, immutable: options?.immutable === true };
    atoms.set(name, entry);
    return disposer(atoms, name, entry);
};

export const unregisterAtom = (name: string): boolean => atoms.delete(name);

export const getRegisteredAtoms = (): ReadonlyMap<string, AtomEntry> => atoms;

export const registerDerived = (name: string, d: Derivable): DisposeFn => {
    derived.set(name, d);
    return disposer(derived, name, d);
};

export const unregisterDerived = (name: string): boolean => derived.delete(name);

export const getRegisteredDerived = (): ReadonlyMap<string, Derivable> => derived;

export const registerAction = (name: string, fn: ActionFn): DisposeFn => {
    actions.set(name, fn);
    return disposer(actions, name, fn);
};

export const unregisterAction = (name: string): boolean => actions.delete(name);

export const getRegisteredActions = (): ReadonlyMap<string, ActionFn> => actions;

// --- Execution frames ---
//
// Each wrapped call owns a frame. `current` is only set while the wrapped
// function runs synchronously, so a log entry is attached to a parent only
// when the nesting is certain. Work that happens after an `await` cannot be
// attributed reliably in a browser (no async context), so it is logged at the
// top level and tagged with the async actions that were in flight (`during`).

export interface Frame {
    readonly name: string;
    readonly startedAt: number;
    readonly children: LogEntry[];
    readonly during: ReadonlyArray<string>;
    open: boolean;
}

let current: Frame | null = null;
const inFlight = new Set<Frame>();

export const currentFrame = (): Frame | null => current;

export const inFlightNames = (): string[] => [...inFlight].map((f) => f.name);

export const openFrame = (name: string): Frame => ({
    name,
    startedAt: Date.now(),
    children: [],
    during: inFlightNames(),
    open: true,
});

export const runInFrame = <T>(frame: Frame, fn: () => T): T => {
    const prev = current;
    current = frame;
    try {
        return fn();
    } finally {
        current = prev;
    }
};

export const markInFlight = (frame: Frame): void => {
    inFlight.add(frame);
};

export const closeFrame = (frame: Frame): void => {
    frame.open = false;
    inFlight.delete(frame);
};

export const getInFlight = (): InFlightInfo[] =>
    [...inFlight].map((f) => ({ name: f.name, startedAt: f.startedAt }));

// --- Log ---

/**
 * Records a finished call. It becomes a child of `parent` if that call is
 * still running, otherwise a top-level entry with a sequence number.
 */
export const addLogEntry = (
    entry: LogEntry,
    parent: Frame | null = current,
    during: ReadonlyArray<string> = [],
): void => {
    if (parent?.open) {
        parent.children.push(entry);
        return;
    }
    const top: LogEntry = {
        ...entry,
        seq: ++lastSeq,
        ...(during.length > 0 ? { during } : {}),
    };
    logs.push(top);
    if (logs.length > LOG_BUFFER_LIMIT) {
        logs.splice(0, logs.length - LOG_BUFFER_LIMIT);
    }
};

export const getLastSeq = (): number => lastSeq;

const mentions = (entry: LogEntry, needle: string): boolean =>
    entry.action.toLowerCase().includes(needle) ||
    (entry.children?.some((c) => mentions(c, needle)) ?? false);

export interface LogQuery {
    readonly limit?: number;
    readonly since?: number;
    readonly name?: string;
}

export const queryLogs = (query: LogQuery = {}): LogsResult => {
    const limit = Math.max(1, Math.min(query.limit ?? 20, LOG_BUFFER_LIMIT));
    const since = query.since ?? 0;
    const needle = query.name?.toLowerCase();
    const matching = logs.filter(
        (e) => (e.seq ?? 0) > since && (needle === undefined || mentions(e, needle)),
    );
    return {
        entries: matching.slice(-limit),
        total: logs.length,
        lastSeq,
        inFlight: getInFlight(),
    };
};

export const getLogs = (): ReadonlyArray<LogEntry> => logs;

export const clearLogs = (): void => {
    logs.length = 0;
};

/** Test helper: empties registry and log. Not part of the public API. */
export const resetRegistryForTests = (): void => {
    atoms.clear();
    derived.clear();
    actions.clear();
    logs.length = 0;
    lastSeq = 0;
    inFlight.clear();
    current = null;
};
