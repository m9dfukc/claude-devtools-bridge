// Atom and action registration with execution log buffer

import type { Watchable, ActionFn, DevtoolsRegistry, LogEntry } from "./types";

const LOG_BUFFER_LIMIT = 1000;

const registry: DevtoolsRegistry = {
    atoms: new Map(),
    actions: new Map(),
    logs: [],
};

export const registerAtom = (name: string, atom: Watchable): void => {
    registry.atoms.set(name, atom);
};

export const registerAction = (name: string, fn: ActionFn): void => {
    registry.actions.set(name, fn);
};

export const getRegisteredAtoms = (): ReadonlyMap<string, Watchable> =>
    registry.atoms;

export const getRegisteredActions = (): ReadonlyMap<string, ActionFn> =>
    registry.actions;

export const addLogEntry = (entry: LogEntry): void => {
    registry.logs.push(entry);
    if (registry.logs.length > LOG_BUFFER_LIMIT) {
        registry.logs.splice(0, registry.logs.length - LOG_BUFFER_LIMIT);
    }
};

export const getLogs = (): ReadonlyArray<LogEntry> => registry.logs;

export const clearLogs = (): void => {
    registry.logs.length = 0;
};
