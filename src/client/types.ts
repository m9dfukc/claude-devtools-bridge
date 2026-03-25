// Shared types for the MCP devtools bridge — framework-agnostic

// --- Core interface: any state container that can read/write ---

export interface Watchable<T = unknown> {
    deref(): T;
    reset(val: T): void;
}

// --- Registry types ---

export type ActionFn = (...args: readonly unknown[]) => unknown;

export interface LogEntry {
    readonly action: string;
    readonly timestamp: number;
    readonly diffs: ReadonlyArray<StateDiff>;
    readonly children?: ReadonlyArray<LogEntry>;
    readonly kind?: "action" | "effect";
    readonly duration?: number;
    readonly args?: unknown;
    readonly result?: unknown;
    readonly error?: string;
}

// --- Derived state (read-only) ---

export interface Derivable<T = unknown> {
    deref(): T;
}

export interface StateDiff {
    readonly atom: string;
    readonly before: unknown;
    readonly after: unknown;
}

// --- WebSocket message protocol ---

export interface GetStateMsg {
    readonly type: "get_state";
    readonly id: string;
}

export interface StateResultMsg {
    readonly type: "state_result";
    readonly id: string;
    readonly data: Record<string, unknown>;
}

export interface SetStateMsg {
    readonly type: "set_state";
    readonly id: string;
    readonly path: string;
    readonly value: unknown;
}

export interface SetStateResultMsg {
    readonly type: "set_state_result";
    readonly id: string;
    readonly success: boolean;
    readonly error?: string;
}

export interface TriggerActionMsg {
    readonly type: "trigger_action";
    readonly id: string;
    readonly name: string;
    readonly payload?: unknown;
}

export interface ActionResultMsg {
    readonly type: "action_result";
    readonly id: string;
    readonly success: boolean;
    readonly result?: unknown;
    readonly error?: string;
}

export interface GetLogsMsg {
    readonly type: "get_logs";
    readonly id: string;
}

export interface LogsResultMsg {
    readonly type: "logs_result";
    readonly id: string;
    readonly data: ReadonlyArray<LogEntry>;
}

export interface ClearLogsMsg {
    readonly type: "clear_logs";
    readonly id: string;
}

export interface ClearLogsResultMsg {
    readonly type: "clear_logs_result";
    readonly id: string;
    readonly success: boolean;
}

// Server → Client messages
export type ServerMessage =
    | GetStateMsg
    | SetStateMsg
    | TriggerActionMsg
    | GetLogsMsg
    | ClearLogsMsg;

// Client → Server messages
export type ClientMessage =
    | StateResultMsg
    | SetStateResultMsg
    | ActionResultMsg
    | LogsResultMsg
    | ClearLogsResultMsg;

// --- Registry interface ---

export interface DevtoolsRegistry {
    readonly atoms: Map<string, Watchable>;
    readonly derived: Map<string, Derivable>;
    readonly actions: Map<string, ActionFn>;
    readonly logs: LogEntry[];
}
