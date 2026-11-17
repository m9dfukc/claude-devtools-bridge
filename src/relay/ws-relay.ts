// WebSocket relay — routes requests from MCP-side clients (MCP server, CLI)
// to browser tabs and the answers back.
//
// - Any number of MCP-side clients and browser tabs may be connected.
// - Nothing is buffered. A request that cannot be delivered is answered
//   immediately with an error, so it can never be replayed later.
// - Requests without an explicit target go to the most recently focused tab.

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
    CLOSE,
    DEFAULT_PATH,
    PROTOCOL_VERSION,
    type BridgeResponse,
    type ErrorCode,
    type RelayHello,
    type RelayStatus,
    type TabInfo,
} from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import { writeDiscovery } from "./discovery.js";

type Role = "mcp" | "browser";

export interface RelayOptions {
    /** WebSocket path. Default "/devtools-bridge". */
    readonly path?: string;
    /**
     * Extra page origins that may connect as a browser, e.g.
     * ["https://dev.example.com"]. Pages on localhost / 127.0.0.1 / [::1] and
     * pages served from the same IP address as the relay are always allowed.
     * "*" allows every origin (not recommended).
     */
    readonly allowedOrigins?: ReadonlyArray<string>;
    /**
     * Shared secret for MCP-side clients (env DEVTOOLS_TOKEN on their side).
     * Without a token, MCP-side clients are only accepted from this machine.
     */
    readonly token?: string;
    /** Write the discovery file so the MCP server finds the port. Default true. */
    readonly discovery?: boolean;
    /** Project root for the discovery file. Default process.cwd(). */
    readonly root?: string;
}

export interface StandaloneRelayOptions extends RelayOptions {
    /** Interface to bind. Default: all interfaces. */
    readonly host?: string;
}

export interface Relay {
    close(): void;
    status(): RelayStatus;
}

interface Tab {
    readonly id: string;
    readonly ws: WebSocket;
    readonly connectedAt: number;
    lastActiveAt: number;
    url?: string;
    title?: string;
    version?: string;
}

interface Pending {
    readonly mcp: WebSocket;
    readonly id: string;
    readonly tab: string;
}

type Verdict =
    | { readonly ok: true; readonly role: Role }
    | { readonly ok: false; readonly code: number; readonly reason: string };

const OPEN = 1;
const WARN_INTERVAL_MS = 30_000;

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const isLoopbackAddress = (addr: string | undefined): boolean =>
    addr !== undefined &&
    (addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127."));

const isIpLiteral = (hostname: string): boolean =>
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");

const hostnameOf = (hostHeader: string | undefined): string | undefined => {
    if (!hostHeader) return undefined;
    try {
        return new URL(`http://${hostHeader}`).hostname;
    } catch {
        return undefined;
    }
};

const createCore = (options: RelayOptions, path: string) => {
    const tabs = new Map<string, Tab>();
    const mcps = new Set<WebSocket>();
    const pending = new Map<string, Pending>();
    const lastWarn = new Map<string, number>();
    let counter = 0;
    let outdatedBrowserSeenAt: number | undefined;

    const warn = (key: string, message: string): void => {
        const now = Date.now();
        if (now - (lastWarn.get(key) ?? 0) < WARN_INTERVAL_MS) return;
        lastWarn.set(key, now);
        console.warn(`[Devtools Bridge] ${message}`);
    };

    const send = (ws: WebSocket, data: unknown): void => {
        if (ws.readyState === OPEN) ws.send(JSON.stringify(data));
    };

    const fail = (ws: WebSocket, id: string, code: ErrorCode, error: string): void =>
        send(ws, { id, ok: false, code, error } satisfies BridgeResponse);

    const activeTab = (): Tab | undefined => {
        let best: Tab | undefined;
        for (const tab of tabs.values()) {
            if (
                !best ||
                tab.lastActiveAt > best.lastActiveAt ||
                (tab.lastActiveAt === best.lastActiveAt && tab.connectedAt >= best.connectedAt)
            ) {
                best = tab;
            }
        }
        return best;
    };

    const status = (): RelayStatus => {
        const active = activeTab();
        const list: TabInfo[] = [...tabs.values()].map((t) => ({
            id: t.id,
            ...(t.url ? { url: t.url } : {}),
            ...(t.title ? { title: t.title } : {}),
            ...(t.version ? { version: t.version } : {}),
            connectedAt: t.connectedAt,
            lastActiveAt: t.lastActiveAt,
            active: t === active,
        }));
        return {
            protocol: PROTOCOL_VERSION,
            version: VERSION,
            path,
            tabs: list,
            mcpClients: mcps.size,
            ...(outdatedBrowserSeenAt !== undefined ? { outdatedBrowserSeenAt } : {}),
        };
    };

    // --- Admission ---

    const originAllowed = (origin: string, req: IncomingMessage): boolean => {
        const allowed = options.allowedOrigins ?? [];
        if (allowed.includes("*") || allowed.includes(origin)) return true;
        let hostname: string;
        try {
            hostname = new URL(origin).hostname;
        } catch {
            return false;
        }
        if (LOOPBACK_NAMES.has(hostname) || hostname.endsWith(".localhost")) return true;
        // A page served from the very IP address the relay was reached on.
        // DNS names are excluded on purpose (DNS rebinding) — list them in allowedOrigins.
        return isIpLiteral(hostname) && hostname === hostnameOf(req.headers.host);
    };

    const verify = (req: IncomingMessage): Verdict => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const role = url.searchParams.get("role");
        if (role !== "mcp" && role !== "browser") {
            return { ok: false, code: CLOSE.BAD_ROLE, reason: "Missing ?role=mcp|browser query param" };
        }
        const origin = req.headers.origin;
        const local = isLoopbackAddress(req.socket.remoteAddress);

        if (role === "mcp") {
            // Browsers always send an Origin header on WebSockets and cannot
            // forge its absence — so a web page can never take the MCP role.
            if (origin !== undefined) {
                warn("mcp-origin", `rejected a web page (${origin}) trying to connect as MCP client`);
                return { ok: false, code: CLOSE.FORBIDDEN, reason: "Web pages cannot connect as MCP client" };
            }
            if (options.token !== undefined) {
                if (url.searchParams.get("token") !== options.token) {
                    warn("mcp-token", "rejected an MCP client with a missing or wrong token (set DEVTOOLS_TOKEN)");
                    return { ok: false, code: CLOSE.FORBIDDEN, reason: "Missing or wrong token (set DEVTOOLS_TOKEN)" };
                }
            } else if (!local) {
                warn("mcp-remote", `rejected an MCP client from ${req.socket.remoteAddress} — remote MCP clients need a token (relay option "token" + DEVTOOLS_TOKEN)`);
                return { ok: false, code: CLOSE.FORBIDDEN, reason: "Remote MCP clients need a token (relay option token + DEVTOOLS_TOKEN)" };
            }
        } else if (origin !== undefined ? !originAllowed(origin, req) : !local) {
            warn(`origin:${origin}`, `rejected a browser connection from origin ${origin ?? "(none)"} — add it to the relay option "allowedOrigins" if this is your app`);
            return {
                ok: false,
                code: CLOSE.FORBIDDEN,
                reason: `Origin ${origin ?? "(none)"} is not allowed (relay option allowedOrigins)`,
            };
        }

        if (Number(url.searchParams.get("v")) !== PROTOCOL_VERSION) {
            if (role === "browser") {
                outdatedBrowserSeenAt = Date.now();
                warn("old-browser", `a browser tab runs an outdated claude-devtools-bridge client (protocol v1, relay speaks v${PROTOCOL_VERSION}) — update the npm dependency of the app and reload`);
                return { ok: false, code: CLOSE.PROTOCOL_MISMATCH, reason: "Outdated client: update claude-devtools-bridge in the app" };
            }
            warn("old-mcp", `rejected an outdated MCP server (protocol v1, relay speaks v${PROTOCOL_VERSION}) — update the Claude Code plugin / MCP server`);
            // 4001 makes v1 MCP servers stop reconnecting.
            return { ok: false, code: CLOSE.REPLACED, reason: "Outdated MCP server: update the devtools-bridge plugin" };
        }
        return { ok: true, role };
    };

    // --- Connections ---

    const acceptMcp = (ws: WebSocket): void => {
        mcps.add(ws);
        send(ws, { type: "relay_hello", protocol: PROTOCOL_VERSION, version: VERSION } satisfies RelayHello);

        ws.on("message", (raw) => {
            let msg: { id?: unknown; type?: unknown; params?: unknown; target?: unknown };
            try {
                msg = JSON.parse(raw.toString()) as typeof msg;
            } catch {
                return;
            }
            if (typeof msg.id !== "string" || typeof msg.type !== "string") return;
            const { id, type } = msg;

            if (type === "relay_status") {
                send(ws, { id, ok: true, data: status() } satisfies BridgeResponse);
                return;
            }

            const tab = typeof msg.target === "string" ? tabs.get(msg.target) : activeTab();
            if (!tab) {
                if (typeof msg.target === "string") {
                    fail(ws, id, "unknown_tab", `No connected tab with id "${msg.target}". Connected tabs: ${[...tabs.keys()].join(", ") || "(none)"}`);
                    return;
                }
                const outdated =
                    outdatedBrowserSeenAt !== undefined && Date.now() - outdatedBrowserSeenAt < 10_000
                        ? " A tab with an outdated claude-devtools-bridge client keeps trying to connect — update the npm dependency of the app and reload the page."
                        : "";
                fail(ws, id, "no_browser", `No browser tab is connected to the relay. Open the app in a browser (dev build) and make sure initDevtools() / connectDevtools() runs.${outdated}`);
                return;
            }

            const relayId = `r${++counter}`;
            pending.set(relayId, { mcp: ws, id, tab: tab.id });
            send(tab.ws, { id: relayId, type, params: msg.params ?? {} });
        });

        ws.on("close", () => {
            mcps.delete(ws);
            for (const [relayId, p] of pending) {
                if (p.mcp === ws) pending.delete(relayId);
            }
        });
        ws.on("error", () => ws.close());
    };

    const acceptBrowser = (ws: WebSocket): void => {
        const now = Date.now();
        const tab: Tab = { id: `t${++counter}`, ws, connectedAt: now, lastActiveAt: 0 };
        tabs.set(tab.id, tab);

        ws.on("message", (raw) => {
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(raw.toString()) as Record<string, unknown>;
            } catch {
                return;
            }
            if (msg["type"] === "page") {
                // In-page navigation: refresh what is shown, leave the focus order alone.
                if (typeof msg["url"] === "string") tab.url = msg["url"];
                if (typeof msg["title"] === "string") tab.title = msg["title"];
                return;
            }
            if (msg["type"] === "hello" || msg["type"] === "active") {
                if (typeof msg["url"] === "string") tab.url = msg["url"];
                if (typeof msg["title"] === "string") tab.title = msg["title"];
                if (typeof msg["version"] === "string") tab.version = msg["version"];
                if (msg["type"] === "active" || msg["focused"] === true) {
                    tab.lastActiveAt = Date.now();
                } else if (typeof msg["activeAt"] === "number") {
                    // Unfocused tab that was just (re)loaded: keep its place in the focus order.
                    tab.lastActiveAt = Math.max(tab.lastActiveAt, Math.min(msg["activeAt"], Date.now()));
                }
                return;
            }
            if (typeof msg["id"] !== "string") return;
            const p = pending.get(msg["id"]);
            if (!p) return;
            pending.delete(msg["id"]);
            send(p.mcp, { ...msg, id: p.id, tab: tab.id });
        });

        ws.on("close", () => {
            tabs.delete(tab.id);
            for (const [relayId, p] of pending) {
                if (p.tab !== tab.id) continue;
                pending.delete(relayId);
                fail(p.mcp, p.id, "browser_disconnected", "The browser tab disconnected (reload, HMR or navigation) before answering. The request may or may not have been executed — check with get_state / get_logs before retrying.");
            }
        });
        ws.on("error", () => ws.close());
    };

    /** Admits or closes a freshly upgraded socket. */
    const accept = (ws: WebSocket, req: IncomingMessage): void => {
        const verdict = verify(req);
        if (!verdict.ok) {
            // Refused after the upgrade (instead of an HTTP error) so that
            // the client can read the reason and stop reconnecting.
            ws.close(verdict.code, verdict.reason.slice(0, 120));
            return;
        }
        if (verdict.role === "mcp") acceptMcp(ws);
        else acceptBrowser(ws);
    };

    const close = (): void => {
        for (const ws of mcps) ws.close(1001, "relay shutting down");
        for (const tab of tabs.values()) tab.ws.close(1001, "relay shutting down");
        mcps.clear();
        tabs.clear();
        pending.clear();
    };

    return { accept, status, close };
};

const isSecure = (server: HttpServer): boolean =>
    typeof (server as { setSecureContext?: unknown }).setSecureContext === "function";

/**
 * Mounts the relay on an existing HTTP(S) server (Vite, Express, …).
 * Only upgrade requests for the relay path are handled, so other WebSocket
 * servers on the same HTTP server (HMR, socket.io, …) keep working.
 */
export const createRelay = (httpServer: HttpServer, options: RelayOptions = {}): Relay => {
    const path = options.path ?? DEFAULT_PATH;
    const core = createCore(options, path);
    const wss = new WebSocketServer({ noServer: true });
    let removeDiscovery: () => void = () => {};
    let closed = false;

    const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const { pathname } = new URL(req.url ?? "/", "http://localhost");
        if (pathname !== path) {
            // Not ours. If nobody else listens for upgrades, don't leave the socket hanging.
            if (httpServer.listenerCount("upgrade") === 1) socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => core.accept(ws, req));
    };
    httpServer.on("upgrade", onUpgrade);

    const announce = (): void => {
        if (closed || options.discovery === false) return;
        const address = httpServer.address();
        if (address === null || typeof address === "string") return;
        removeDiscovery = writeDiscovery({
            protocol: PROTOCOL_VERSION,
            version: VERSION,
            pid: process.pid,
            port: address.port,
            secure: isSecure(httpServer),
            path,
            root: options.root ?? process.cwd(),
            startedAt: Date.now(),
            ...(options.token !== undefined ? { tokenRequired: true } : {}),
        });
    };
    if (httpServer.listening) announce();
    else httpServer.once("listening", announce);

    // Covers exits where the HTTP server is not closed first (process.exit()).
    const onExit = (): void => removeDiscovery();
    process.once("exit", onExit);

    const close = (): void => {
        if (closed) return;
        closed = true;
        httpServer.off("upgrade", onUpgrade);
        httpServer.off("listening", announce);
        process.off("exit", onExit);
        removeDiscovery();
        core.close();
        wss.close();
    };
    httpServer.once("close", close);

    console.log(`[Devtools Bridge] mounted on path ${path}`);
    return { close, status: core.status };
};

/** Standalone mode — creates its own HTTP server for the relay. */
export const createStandaloneRelay = (port: number, options: StandaloneRelayOptions = {}): Relay => {
    const server = createServer((_req, res) => {
        res.writeHead(426, { "Content-Type": "text/plain" });
        res.end("claude-devtools-bridge relay — WebSocket only\n");
    });
    server.on("error", (err) => {
        console.error(`[Devtools Bridge] standalone relay failed: ${err.message}`);
    });
    const relay = createRelay(server, options);
    server.listen(port, options.host, () => {
        console.log(`[Devtools Bridge] standalone relay listening on :${port}${options.path ?? DEFAULT_PATH}`);
    });
    return {
        status: relay.status,
        close: () => {
            relay.close();
            server.close();
            server.closeAllConnections();
        },
    };
};

/**
 * Attaches the relay to a WebSocketServer you manage yourself. You are
 * responsible for routing only the relay path to it.
 */
export const createRelayFromWss = (wss: WebSocketServer, options: RelayOptions | number = {}): Relay => {
    const opts = typeof options === "number" ? {} : options;
    const core = createCore(opts, opts.path ?? DEFAULT_PATH);
    wss.on("connection", (ws, req) => core.accept(ws, req));
    return {
        status: core.status,
        close: () => {
            core.close();
            wss.close();
        },
    };
};
