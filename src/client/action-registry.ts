// Atom, derived, and action registration with execution log buffer + context stack

import type { Watchable, Derivable, ActionFn, DevtoolsRegistry, LogEntry, DisposeFn } from "./types";

const LOG_BUFFER_LIMIT = 1000;

const registry: DevtoolsRegistry = {
    atoms: new Map(),
    derived: new Map(),
    actions: new Map(),
    logs: [],
};

// --- Execution context stack (for nested action tree logging) ---

const executionStack: LogEntry[][] = [];

export const pushExecutionContext = (): void => {
    executionStack.push([]);
};

export const popExecutionContext = (): ReadonlyArray<LogEntry> => {
    return executionStack.pop() ?? [];
};

export const currentExecutionDepth = (): number => executionStack.length;

// --- Atom registration ---

export const registerAtom = (name: string, atom: Watchable): DisposeFn => {
    registry.atoms.set(name, atom);
    return () => registry.atoms.delete(name);
};

export const unregisterAtom = (name: string): boolean =>
    registry.atoms.delete(name);

export const getRegisteredAtoms = (): ReadonlyMap<string, Watchable> =>
    registry.atoms;

// --- Derived state registration ---

export const registerDerived = (name: string, derived: Derivable): DisposeFn => {
    registry.derived.set(name, derived);
    return () => registry.derived.delete(name);
};

export const unregisterDerived = (name: string): boolean =>
    registry.derived.delete(name);

export const getRegisteredDerived = (): ReadonlyMap<string, Derivable> =>
    registry.derived;

// --- Action registration ---

export const registerAction = (name: string, fn: ActionFn): DisposeFn => {
    registry.actions.set(name, fn);
    return () => registry.actions.delete(name);
};

export const unregisterAction = (name: string): boolean =>
    registry.actions.delete(name);

export const getRegisteredActions = (): ReadonlyMap<string, ActionFn> =>
    registry.actions;

// --- Log management ---

export const addLogEntry = (entry: LogEntry): void => {
    // If inside a nested execution, add to parent's children collector
    if (executionStack.length > 0) {
        executionStack[executionStack.length - 1]!.push(entry);
    } else {
        registry.logs.push(entry);
        if (registry.logs.length > LOG_BUFFER_LIMIT) {
            registry.logs.splice(0, registry.logs.length - LOG_BUFFER_LIMIT);
        }
    }
};

export const getLogs = (): ReadonlyArray<LogEntry> => registry.logs;

export const clearLogs = (): void => {
    registry.logs.length = 0;
};
