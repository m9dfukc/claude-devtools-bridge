export declare const PROTOCOL_VERSION = 2;
export declare const DEFAULT_PATH = "/devtools-bridge";
export declare const DEFAULT_PORT = 5173;
/** WebSocket close codes used by the relay. */
export declare const CLOSE: {
    readonly BAD_ROLE: 4000;
    /** v1 "replaced" code. v1 MCP servers stop reconnecting when they see it. */
    readonly REPLACED: 4001;
    readonly PROTOCOL_MISMATCH: 4002;
    readonly FORBIDDEN: 4003;
};
/** Codes after which a client must not reconnect on its own. */
export declare const FATAL_CLOSE_CODES: ReadonlySet<number>;
export type BrowserRequestType = "describe" | "get_state" | "set_state" | "trigger_action" | "get_logs" | "clear_logs";
export type RequestType = BrowserRequestType | "relay_status";
export interface BridgeRequest {
    readonly id: string;
    readonly type: RequestType;
    readonly params?: Record<string, unknown>;
    /** Tab id (from relay_status). Default: the most recently focused tab. */
    readonly target?: string;
}
export type ErrorCode = "no_browser" | "unknown_tab" | "browser_disconnected" | "bad_request" | "not_found" | "read_only" | "handler_error";
export interface OkResponse {
    readonly id: string;
    readonly ok: true;
    readonly data: unknown;
    /** Set by the relay: which tab answered. */
    readonly tab?: string;
}
export interface ErrorResponse {
    readonly id: string;
    readonly ok: false;
    readonly code: ErrorCode;
    readonly error: string;
    readonly tab?: string;
}
export type BridgeResponse = OkResponse | ErrorResponse;
/** Browser → relay, right after connecting and whenever the tab gains focus. */
export interface BrowserHello {
    readonly type: "hello" | "active";
    readonly protocol?: number;
    readonly version?: string;
    readonly url?: string;
    readonly title?: string;
    readonly focused?: boolean;
    /** Epoch ms when the tab last had focus (survives reloads of the tab). */
    readonly activeAt?: number;
}
/** Relay → MCP-side client, right after connecting. v1 relays never send it. */
export interface RelayHello {
    readonly type: "relay_hello";
    readonly protocol: number;
    readonly version: string;
}
export interface TabInfo {
    readonly id: string;
    readonly url?: string;
    readonly title?: string;
    readonly version?: string;
    readonly connectedAt: number;
    readonly lastActiveAt: number;
    /** True for the tab that receives requests without an explicit target. */
    readonly active: boolean;
}
export interface RelayStatus {
    readonly protocol: number;
    readonly version: string;
    readonly path: string;
    readonly tabs: ReadonlyArray<TabInfo>;
    readonly mcpClients: number;
    /** Epoch ms of the last rejected v1 browser client, if any. */
    readonly outdatedBrowserSeenAt?: number;
}
export interface Change {
    /** Path inside the container, "" for the root value. */
    readonly path: string;
    readonly op: "set" | "add" | "remove";
    readonly before?: unknown;
    readonly after?: unknown;
    /**
     * Set when many array items were added or removed at once: `path` is then
     * a range ("items[3…119]") and before/after holds only the first item.
     */
    readonly count?: number;
}
export interface StateDiff {
    readonly atom: string;
    readonly changes: ReadonlyArray<Change>;
    /** True when the change list was capped. */
    readonly truncated?: boolean;
}
export interface LogEntry {
    /** Monotonic sequence number. Only top-level entries have one. */
    readonly seq?: number;
    readonly action: string;
    readonly kind: "action" | "effect" | "set_state";
    /** Epoch ms when the call started. */
    readonly timestamp: number;
    readonly duration?: number;
    /** True when the wrapped function returned a promise. */
    readonly async?: boolean;
    readonly diffs: ReadonlyArray<StateDiff>;
    readonly children?: ReadonlyArray<LogEntry>;
    readonly args?: unknown;
    readonly result?: unknown;
    readonly error?: string;
    /** Async actions that were in flight when this call started. */
    readonly during?: ReadonlyArray<string>;
}
export interface ContainerInfo {
    readonly name: string;
    /** "object" | "array" | "string" | "number" | "boolean" | "null" */
    readonly type: string;
    /** Top-level keys (objects) — capped. */
    readonly keys?: ReadonlyArray<string>;
    /** Array length. */
    readonly length?: number;
    /** Approximate size of the JSON serialization in characters. */
    readonly size: number;
    readonly immutable?: boolean;
    readonly error?: string;
}
export interface InFlightInfo {
    readonly name: string;
    readonly startedAt: number;
}
export interface Description {
    readonly version: string;
    readonly protocol: number;
    readonly url?: string;
    readonly title?: string;
    readonly atoms: ReadonlyArray<ContainerInfo>;
    readonly derived: ReadonlyArray<ContainerInfo>;
    readonly actions: ReadonlyArray<string>;
    readonly logs: {
        readonly count: number;
        readonly lastSeq: number;
    };
    readonly inFlight: ReadonlyArray<InFlightInfo>;
}
export interface GetStateResult {
    readonly value: unknown;
    /** Human-readable note when the value was shortened to fit max_chars. */
    readonly truncated?: string;
}
export interface SetStateResult {
    readonly changes: ReadonlyArray<Change>;
    readonly truncated?: boolean;
    readonly previousType: string;
    readonly newType: string;
}
export interface ActionResult {
    readonly result?: unknown;
    /** Set when the action threw / rejected. */
    readonly error?: string;
    readonly duration: number;
    readonly diffs: ReadonlyArray<StateDiff>;
    /** Log entries recorded while the action ran. */
    readonly logs: ReadonlyArray<LogEntry>;
    readonly resultTruncated?: string;
}
export interface LogsResult {
    readonly entries: ReadonlyArray<LogEntry>;
    /** Entries currently in the buffer. */
    readonly total: number;
    readonly lastSeq: number;
    readonly inFlight: ReadonlyArray<InFlightInfo>;
}
