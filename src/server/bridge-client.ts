// Connection from the MCP side (MCP server, CLI) to the relay.
//
// Connects lazily on the first request and again whenever the connection was
// lost, so there are no reconnect loops and no state that needs a restart.
// Every failure mode maps to a message that says what to do about it.

import { WebSocket } from "ws";
import {
    CLOSE,
    PROTOCOL_VERSION,
    type BridgeResponse,
    type RelayHello,
    type RequestType,
} from "../shared/protocol.js";
import { resolveEndpoint, type Endpoint } from "./discover.js";

const HANDSHAKE_TIMEOUT_MS = 3000;
const HELLO_TIMEOUT_MS = 1500;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ConnState =
    | { readonly kind: "idle" }
    | { readonly kind: "connected"; readonly relay: RelayHello }
    | { readonly kind: "unreachable"; readonly error: string }
    | { readonly kind: "not_a_relay"; readonly detail: string }
    | { readonly kind: "legacy_relay" }
    | { readonly kind: "rejected"; readonly code: number; readonly reason: string };

export class BridgeError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

export interface BridgeClientOptions {
    readonly env?: NodeJS.ProcessEnv;
    readonly cwd?: string;
    readonly log?: (message: string) => void;
}

export interface RequestOptions {
    readonly tab?: string;
    readonly timeoutMs?: number;
}

interface PendingRequest {
    readonly resolve: (data: unknown) => void;
    readonly reject: (err: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

const isLoopbackUrl = (url: string): boolean => {
    try {
        const { hostname } = new URL(url);
        return hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
    } catch {
        return false;
    }
};

export class BridgeClient {
    private ws: WebSocket | null = null;
    private state: ConnState = { kind: "idle" };
    private endpoint: Endpoint;
    private connecting: Promise<ConnState> | null = null;
    private readonly pending = new Map<string, PendingRequest>();
    private nextId = 0;
    private readonly env: NodeJS.ProcessEnv;
    private readonly cwd: string;
    private readonly log: (message: string) => void;

    constructor(options: BridgeClientOptions = {}) {
        this.env = options.env ?? process.env;
        this.cwd = options.cwd ?? process.cwd();
        this.log = options.log ?? (() => {});
        this.endpoint = resolveEndpoint(this.env, this.cwd);
    }

    getState(): ConnState {
        return this.state;
    }

    getEndpoint(): Endpoint {
        return this.endpoint;
    }

    get defaultTimeoutMs(): number {
        const n = Number(this.env["DEVTOOLS_TIMEOUT_MS"]);
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
    }

    /** Connects if necessary. Never throws — inspect the returned state. */
    async connect(): Promise<ConnState> {
        if (this.state.kind === "connected") return this.state;
        if (!this.connecting) {
            this.connecting = this.attempt().finally(() => {
                this.connecting = null;
            });
        }
        return this.connecting;
    }

    private attempt(): Promise<ConnState> {
        // Resolved on every attempt: the dev server may have moved to another port.
        this.endpoint = resolveEndpoint(this.env, this.cwd);
        const base = this.endpoint.url;
        const token = this.env["DEVTOOLS_TOKEN"];
        const sep = base.includes("?") ? "&" : "?";
        const url = `${base}${sep}role=mcp&v=${PROTOCOL_VERSION}${token ? `&token=${encodeURIComponent(token)}` : ""}`;

        return new Promise<ConnState>((resolve) => {
            let settled = false;
            let lastError: string | undefined;
            let helloTimer: ReturnType<typeof setTimeout> | undefined;

            const settle = (state: ConnState): void => {
                if (helloTimer) clearTimeout(helloTimer);
                if (settled) return;
                settled = true;
                this.state = state;
                resolve(state);
            };

            let socket: WebSocket;
            try {
                socket = new WebSocket(url, {
                    handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
                    // Dev servers with self-signed certificates (vite basic-ssl, mkcert).
                    rejectUnauthorized: !isLoopbackUrl(base),
                });
            } catch (err) {
                settle({ kind: "unreachable", error: (err as Error).message });
                return;
            }

            socket.on("open", () => {
                helloTimer = setTimeout(() => {
                    settle({ kind: "legacy_relay" });
                    socket.close();
                }, HELLO_TIMEOUT_MS);
            });

            socket.on("unexpected-response", (req, res) => {
                req.destroy();
                settle({ kind: "not_a_relay", detail: `HTTP ${res.statusCode}` });
            });

            socket.on("message", (raw) => {
                let msg: Record<string, unknown>;
                try {
                    msg = JSON.parse(raw.toString()) as Record<string, unknown>;
                } catch {
                    return;
                }
                if (msg["type"] === "relay_hello") {
                    this.ws = socket;
                    this.log(`connected to relay at ${base}`);
                    settle({ kind: "connected", relay: msg as unknown as RelayHello });
                    return;
                }
                if (typeof msg["id"] !== "string") return;
                const entry = this.pending.get(msg["id"]);
                if (!entry) return;
                this.pending.delete(msg["id"]);
                clearTimeout(entry.timer);
                const res = msg as unknown as BridgeResponse;
                if (res.ok) entry.resolve(res.data);
                else entry.reject(new BridgeError(res.code, res.error));
            });

            socket.on("error", (err) => {
                const code = (err as NodeJS.ErrnoException).code;
                lastError = /handshake has timed out/i.test(err.message)
                    ? "handshake_timeout"
                    : code ?? err.message;
            });

            socket.on("close", (code, reason) => {
                const wasConnected = this.ws === socket;
                if (wasConnected) {
                    this.ws = null;
                    this.state = { kind: "idle" };
                    this.log(`relay connection closed (${code})`);
                    for (const [id, entry] of this.pending) {
                        this.pending.delete(id);
                        clearTimeout(entry.timer);
                        entry.reject(
                            new BridgeError(
                                "relay_closed",
                                "The connection to the relay closed before the answer arrived (dev server stopped or restarted). The request may or may not have been executed — check with status / get_logs before retrying.",
                            ),
                        );
                    }
                    return;
                }
                if (code >= CLOSE.BAD_ROLE && code <= CLOSE.FORBIDDEN) {
                    settle({ kind: "rejected", code, reason: reason.toString() });
                } else if (lastError === "handshake_timeout") {
                    settle({ kind: "not_a_relay", detail: "no answer to the WebSocket handshake" });
                } else {
                    settle({ kind: "unreachable", error: lastError ?? `closed with code ${code}` });
                }
            });
        });
    }

    /** Human-readable explanation of why there is no connection. */
    explain(state: ConnState = this.state): string {
        const { url, source } = this.endpoint;
        const where = `${url} (from: ${source})`;
        switch (state.kind) {
            case "connected":
                return `Connected to the relay at ${where}.`;
            case "idle":
                return `Not connected yet. Relay address: ${where}.`;
            case "unreachable":
                return [
                    `Cannot reach the relay at ${where}: ${state.error}.`,
                    state.error === "ECONNREFUSED"
                        ? "Nothing is listening on that port. Start the dev server — or, if it runs on another port, set DEVTOOLS_PORT for the MCP server."
                        : "Check that the dev server is running and reachable from this process.",
                ].join("\n");
            case "not_a_relay":
                return [
                    `A server answers at ${where}, but not as a devtools-bridge relay (${state.detail}).`,
                    "The relay is probably not mounted on this dev server: add devtoolsBridgePlugin() to vite.config (or mountDevtoolsBridge(server) / startDevtoolsBridge(port)), restart the dev server, or point DEVTOOLS_PORT at the right server.",
                ].join("\n");
            case "legacy_relay":
                return [
                    `The relay at ${where} speaks an older protocol than this MCP server (v${PROTOCOL_VERSION}).`,
                    "Update the claude-devtools-bridge npm dependency of the app to the same version as the plugin and restart the dev server.",
                ].join("\n");
            case "rejected":
                return [
                    `The relay at ${where} refused the connection: ${state.reason || `close code ${state.code}`}.`,
                    state.code === CLOSE.PROTOCOL_MISMATCH || state.code === CLOSE.REPLACED
                        ? "Plugin / MCP server and the npm dependency of the app must be on the same version."
                        : "If the relay runs on another machine or in a container, configure a token on both sides (relay option `token`, DEVTOOLS_TOKEN for the MCP server).",
                ].join("\n");
        }
    }

    /** Sends a request and resolves with the `data` of the answer. Throws BridgeError. */
    async request<T>(type: RequestType, params: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
        let state = await this.connect();
        if (state.kind === "unreachable") {
            // The dev server may just be starting up.
            await new Promise((r) => setTimeout(r, 700));
            state = await this.connect();
        }
        const ws = this.ws;
        if (state.kind !== "connected" || !ws) {
            throw new BridgeError(state.kind, this.explain(state));
        }

        const id = `q${++this.nextId}`;
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new BridgeError(
                        "timeout",
                        `No answer from the browser tab within ${timeoutMs}ms. The tab may be paused (background-tab throttling, a debugger breakpoint, a long task) or the call is still running — it was NOT cancelled and will not be repeated. Check get_logs / get_state before retrying.`,
                    ),
                );
            }, timeoutMs);
            this.pending.set(id, { resolve: resolve as (data: unknown) => void, reject, timer });
            ws.send(JSON.stringify({ id, type, params, ...(options.tab ? { target: options.tab } : {}) }));
        });
    }

    close(): void {
        for (const entry of this.pending.values()) clearTimeout(entry.timer);
        this.pending.clear();
        this.ws?.close();
        this.ws = null;
    }
}
