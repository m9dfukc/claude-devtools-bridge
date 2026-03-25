import type { Watchable, ActionFn, LogEntry } from "./types";
export declare const registerAtom: (name: string, atom: Watchable) => void;
export declare const registerAction: (name: string, fn: ActionFn) => void;
export declare const getRegisteredAtoms: () => ReadonlyMap<string, Watchable>;
export declare const getRegisteredActions: () => ReadonlyMap<string, ActionFn>;
export declare const addLogEntry: (entry: LogEntry) => void;
export declare const getLogs: () => ReadonlyArray<LogEntry>;
export declare const clearLogs: () => void;
//# sourceMappingURL=action-registry.d.ts.map