// Public types of the browser-side client — framework-agnostic

export type {
    Change,
    StateDiff,
    LogEntry,
    Description,
    GetStateResult,
    SetStateResult,
    ActionResult,
    LogsResult,
} from "../shared/protocol.js";

/** Any state container that can be read and replaced. */
export interface Watchable<T = unknown> {
    deref(): T;
    reset(val: T): void;
}

/** Read-only derived / computed state. */
export interface Derivable<T = unknown> {
    deref(): T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ActionFn = (...args: any[]) => unknown;

export type DisposeFn = () => boolean;

export interface AtomOptions {
    /**
     * Set to true when the container is only ever replaced, never mutated in
     * place (@thi.ng/atom, Zustand, Redux, Jotai…). Snapshots then keep
     * references instead of deep-cloning, and unchanged subtrees are skipped
     * by identity — wrapAction becomes almost free.
     */
    readonly immutable?: boolean;
}
