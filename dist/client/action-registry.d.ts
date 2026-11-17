import type { InFlightInfo, LogEntry, LogsResult } from "../shared/protocol.js";
import type { ActionFn, AtomOptions, Derivable, DisposeFn, Watchable } from "./types.js";
export interface AtomEntry {
    readonly atom: Watchable;
    readonly immutable: boolean;
}
export declare const registerAtom: (name: string, atom: Watchable, options?: AtomOptions) => DisposeFn;
export declare const unregisterAtom: (name: string) => boolean;
export declare const getRegisteredAtoms: () => ReadonlyMap<string, AtomEntry>;
export declare const registerDerived: (name: string, d: Derivable) => DisposeFn;
export declare const unregisterDerived: (name: string) => boolean;
export declare const getRegisteredDerived: () => ReadonlyMap<string, Derivable>;
export declare const registerAction: (name: string, fn: ActionFn) => DisposeFn;
export declare const unregisterAction: (name: string) => boolean;
export declare const getRegisteredActions: () => ReadonlyMap<string, ActionFn>;
export interface Frame {
    readonly name: string;
    readonly startedAt: number;
    readonly children: LogEntry[];
    readonly during: ReadonlyArray<string>;
    open: boolean;
}
export declare const currentFrame: () => Frame | null;
export declare const inFlightNames: () => string[];
export declare const openFrame: (name: string) => Frame;
export declare const runInFrame: <T>(frame: Frame, fn: () => T) => T;
export declare const markInFlight: (frame: Frame) => void;
export declare const closeFrame: (frame: Frame) => void;
export declare const getInFlight: () => InFlightInfo[];
/**
 * Records a finished call. It becomes a child of `parent` if that call is
 * still running, otherwise a top-level entry with a sequence number.
 */
export declare const addLogEntry: (entry: LogEntry, parent?: Frame | null, during?: ReadonlyArray<string>) => void;
export declare const getLastSeq: () => number;
export interface LogQuery {
    readonly limit?: number;
    readonly since?: number;
    readonly name?: string;
}
export declare const queryLogs: (query?: LogQuery) => LogsResult;
export declare const getLogs: () => ReadonlyArray<LogEntry>;
export declare const clearLogs: () => void;
/** Test helper: empties registry and log. Not part of the public API. */
export declare const resetRegistryForTests: () => void;
