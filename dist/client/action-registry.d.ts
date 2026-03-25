import type { Watchable, Derivable, ActionFn, LogEntry } from "./types";
export declare const pushExecutionContext: () => void;
export declare const popExecutionContext: () => ReadonlyArray<LogEntry>;
export declare const currentExecutionDepth: () => number;
export declare const registerAtom: (name: string, atom: Watchable) => void;
export declare const getRegisteredAtoms: () => ReadonlyMap<string, Watchable>;
export declare const registerDerived: (name: string, derived: Derivable) => void;
export declare const getRegisteredDerived: () => ReadonlyMap<string, Derivable>;
export declare const registerAction: (name: string, fn: ActionFn) => void;
export declare const getRegisteredActions: () => ReadonlyMap<string, ActionFn>;
export declare const addLogEntry: (entry: LogEntry) => void;
export declare const getLogs: () => ReadonlyArray<LogEntry>;
export declare const clearLogs: () => void;
//# sourceMappingURL=action-registry.d.ts.map