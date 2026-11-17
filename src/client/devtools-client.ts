// Browser-side WebSocket client. Connects to the relay on the dev server and
// answers requests from the MCP side.

import {
    DEFAULT_PATH,
    DEFAULT_PORT,
    FATAL_CLOSE_CODES,
    PROTOCOL_VERSION,
    type BridgeResponse,
    type BrowserHello,
    type ErrorCode,
} from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import { installGlobal } from "./global.js";
import { handleRequest, HandlerError } from "./handlers.js";
import type { DisposeFn } from "./types.js";

const RECONNECT_INTERVAL_MS = 2000;
/** Keeps the socket open across unmount → mount (route change, HMR). */
const CLOSE_GRACE_MS = 300;

export interface ConnectOptions {
    /** Full relay URL, e.g. "ws://192.168.1.20:7777/devtools-bridge". Overrides everything else. */
    readonly url?: string;
    /** Relay host. Default: the host the page was loaded from. */
    readonly host?: string;
    /** Relay port. Default: the port the page was loaded from (the dev server). */
    readonly port?: number;
    /** Relay path. Default: "/devtools-bridge". */
    readonly path?: string;
}

interface LocationLike {
    readonly protocol?: string;
    readonly hostname?: string;
    readonly port?: string;
    readonly href?: string;
}

/** Exported for tests. */
export const resolveRelayUrl = (options: ConnectOptions = {}, loc?: LocationLike): string => {
    if (options.url) return options.url;
    const path = options.path ?? DEFAULT_PATH;
    const pageHost = loc?.hostname || undefined;
    const host = options.host ?? pageHost ?? "localhost";
    const samePage = pageHost !== undefined && host === pageHost;
    const pagePort = loc?.port ?? "";
    const port =
        options.port !== undefined
            ? String(options.port)
            : pageHost !== undefined && options.host === undefined
              ? pagePort
              : String(DEFAULT_PORT);
    // wss only when talking to the server that served the page over https.
    const secure = loc?.protocol === "https:" && samePage && port === pagePort;
    const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${secure ? "wss" : "ws"}://${h}${port ? `:${port}` : ""}${path}`;
};

interface Connection {
    refs: number;
    close(): void;
    /** Tells the relay the page's URL / title if they changed since last reported. */
    announcePage(): void;
    closeTimer: ReturnType<typeof setTimeout> | null;
}

const connections = new Map<string, Connection>();

// When this tab last had focus. Kept in sessionStorage so that a reload (HMR,
// navigation) does not make the tab look less recently used than its siblings.
const ACTIVE_KEY = "__devtools_bridge_active_at";

const readActiveAt = (): number => {
    try {
        const raw = (globalThis as { sessionStorage?: Storage }).sessionStorage?.getItem(ACTIVE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    } catch {
        return 0;
    }
};

const markActive = (): void => {
    try {
        (globalThis as { sessionStorage?: Storage }).sessionStorage?.setItem(ACTIVE_KEY, String(Date.now()));
    } catch {
        // storage unavailable — focus order then only lasts until the next reload
    }
};

const pageLocation = (): Pick<BrowserHello, "url" | "title"> => {
    const g = globalThis as { location?: LocationLike; document?: { title?: string } };
    return {
        ...(g.location?.href ? { url: g.location.href } : {}),
        ...(g.document?.title ? { title: g.document.title } : {}),
    };
};

const pageInfo = (): Pick<BrowserHello, "url" | "title" | "focused" | "activeAt"> => {
    const g = globalThis as { document?: { hasFocus?: () => boolean } };
    let focused = false;
    try {
        focused = g.document?.hasFocus?.() ?? false;
    } catch {
        focused = false;
    }
    if (focused) markActive();
    return { ...pageLocation(), focused, activeAt: readActiveAt() };
};

const open = (url: string): Connection => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const send = (data: unknown): void => {
        if (ws?.readyState === 1) ws.send(JSON.stringify(data));
    };

    const respond = (id: string, run: () => Promise<unknown>): void => {
        run().then(
            (data) => send({ id, ok: true, data } satisfies BridgeResponse),
            (err: unknown) => {
                const code: ErrorCode = err instanceof HandlerError ? err.code : "handler_error";
                const error = err instanceof Error ? err.message : String(err);
                if (code === "handler_error") {
                    console.error("[Devtools Bridge] error handling request:", err);
                }
                send({ id, ok: false, code, error } satisfies BridgeResponse);
            },
        );
    };

    // What the relay was last told about this page.
    let sentUrl: string | undefined;
    let sentTitle: string | undefined;

    const announce = (type: BrowserHello["type"]): void => {
        if (ws?.readyState !== 1) return;
        // `page` must not touch the focus order: no `focused`, no `activeAt`.
        const info = type === "page" ? pageLocation() : pageInfo();
        sentUrl = info.url;
        sentTitle = info.title;
        send({
            type,
            ...(type === "hello" ? { protocol: PROTOCOL_VERSION, version: VERSION } : {}),
            ...info,
        } satisfies BrowserHello);
    };

    const announcePage = (): void => {
        const { url, title } = pageLocation();
        if (url !== sentUrl || title !== sentTitle) announce("page");
    };

    const onFocus = (): void => {
        markActive();
        announce("active");
    };
    const onVisibility = (): void => {
        const doc = (globalThis as { document?: { visibilityState?: string } }).document;
        if (doc?.visibilityState === "visible") onFocus();
    };
    const target = globalThis as {
        addEventListener?: (t: string, l: () => void) => void;
        removeEventListener?: (t: string, l: () => void) => void;
        document?: {
            addEventListener?: (t: string, l: () => void) => void;
            removeEventListener?: (t: string, l: () => void) => void;
        };
    };
    target.addEventListener?.("focus", onFocus);
    target.document?.addEventListener?.("visibilitychange", onVisibility);
    // In-page navigation. pushState / replaceState fire no event; those are
    // picked up when a component (re)connects and before each request is answered.
    target.addEventListener?.("hashchange", announcePage);
    target.addEventListener?.("popstate", announcePage);

    const connect = (): void => {
        if (disposed) return;
        const sep = url.includes("?") ? "&" : "?";
        const socket = new WebSocket(`${url}${sep}role=browser&v=${PROTOCOL_VERSION}`);
        ws = socket;

        socket.onopen = () => {
            console.log(`[Devtools Bridge] connected to ${url}`);
            announce("hello");
        };

        socket.onmessage = (event) => {
            let msg: { id?: unknown; type?: unknown; params?: unknown };
            try {
                msg = JSON.parse(String(event.data)) as typeof msg;
            } catch {
                return;
            }
            if (typeof msg.id !== "string" || typeof msg.type !== "string") return;
            const { id, type } = msg;
            const params = (msg.params ?? {}) as Record<string, unknown>;
            announcePage();
            respond(id, () => handleRequest(type, params));
        };

        socket.onclose = (event) => {
            if (ws === socket) ws = null;
            if (disposed) return;
            if (FATAL_CLOSE_CODES.has(event.code)) {
                console.warn(
                    `[Devtools Bridge] relay refused the connection (${event.code}): ${event.reason || "no reason given"} — not reconnecting.`,
                );
                return;
            }
            reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL_MS);
        };

        socket.onerror = () => {
            socket.close();
        };
    };

    connect();

    return {
        refs: 0,
        closeTimer: null,
        announcePage,
        close: () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            target.removeEventListener?.("focus", onFocus);
            target.document?.removeEventListener?.("visibilitychange", onVisibility);
            target.removeEventListener?.("hashchange", announcePage);
            target.removeEventListener?.("popstate", announcePage);
            ws?.close();
        },
    };
};

/**
 * Connects to the relay. Safe to call from several places (one per sketch,
 * component, route…): calls with the same target share one socket, which
 * closes shortly after the last disposer ran.
 */
export const connectDevtools = (options?: ConnectOptions): DisposeFn => {
    installGlobal();
    if (typeof WebSocket === "undefined") {
        console.warn("[Devtools Bridge] no WebSocket implementation in this environment — not connecting.");
        return () => false;
    }
    const url = resolveRelayUrl(options, (globalThis as { location?: LocationLike }).location);

    let conn = connections.get(url);
    if (!conn) {
        conn = open(url);
        connections.set(url, conn);
    } else {
        // A component that mounts and connects usually means a route change.
        conn.announcePage();
    }
    if (conn.closeTimer) {
        clearTimeout(conn.closeTimer);
        conn.closeTimer = null;
    }
    conn.refs++;

    const mine = conn;
    let disposed = false;
    return () => {
        if (disposed) return false;
        disposed = true;
        if (--mine.refs > 0) return true;
        mine.closeTimer = setTimeout(() => {
            mine.closeTimer = null;
            if (mine.refs > 0) return;
            mine.close();
            if (connections.get(url) === mine) connections.delete(url);
        }, CLOSE_GRACE_MS);
        return true;
    };
};
