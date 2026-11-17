// Browser-side WebSocket client. Connects to the relay on the dev server and
// answers requests from the MCP side.
import { DEFAULT_PATH, DEFAULT_PORT, FATAL_CLOSE_CODES, PROTOCOL_VERSION, } from "../shared/protocol.js";
import { VERSION } from "../shared/version.js";
import { installGlobal } from "./global.js";
import { handleRequest, HandlerError } from "./handlers.js";
const RECONNECT_INTERVAL_MS = 2000;
/** Keeps the socket open across unmount → mount (route change, HMR). */
const CLOSE_GRACE_MS = 300;
/** Exported for tests. */
export const resolveRelayUrl = (options = {}, loc) => {
    if (options.url)
        return options.url;
    const path = options.path ?? DEFAULT_PATH;
    const pageHost = loc?.hostname || undefined;
    const host = options.host ?? pageHost ?? "localhost";
    const samePage = pageHost !== undefined && host === pageHost;
    const pagePort = loc?.port ?? "";
    const port = options.port !== undefined
        ? String(options.port)
        : pageHost !== undefined && options.host === undefined
            ? pagePort
            : String(DEFAULT_PORT);
    // wss only when talking to the server that served the page over https.
    const secure = loc?.protocol === "https:" && samePage && port === pagePort;
    const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `${secure ? "wss" : "ws"}://${h}${port ? `:${port}` : ""}${path}`;
};
const connections = new Map();
// When this tab last had focus. Kept in sessionStorage so that a reload (HMR,
// navigation) does not make the tab look less recently used than its siblings.
const ACTIVE_KEY = "__devtools_bridge_active_at";
const readActiveAt = () => {
    try {
        const raw = globalThis.sessionStorage?.getItem(ACTIVE_KEY);
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    }
    catch {
        return 0;
    }
};
const markActive = () => {
    try {
        globalThis.sessionStorage?.setItem(ACTIVE_KEY, String(Date.now()));
    }
    catch {
        // storage unavailable — focus order then only lasts until the next reload
    }
};
const pageInfo = () => {
    const g = globalThis;
    let focused = false;
    try {
        focused = g.document?.hasFocus?.() ?? false;
    }
    catch {
        focused = false;
    }
    if (focused)
        markActive();
    return {
        ...(g.location?.href ? { url: g.location.href } : {}),
        ...(g.document?.title ? { title: g.document.title } : {}),
        focused,
        activeAt: readActiveAt(),
    };
};
const open = (url) => {
    let ws = null;
    let reconnectTimer = null;
    let disposed = false;
    const send = (data) => {
        if (ws?.readyState === 1)
            ws.send(JSON.stringify(data));
    };
    const respond = (id, run) => {
        run().then((data) => send({ id, ok: true, data }), (err) => {
            const code = err instanceof HandlerError ? err.code : "handler_error";
            const error = err instanceof Error ? err.message : String(err);
            if (code === "handler_error") {
                console.error("[Devtools Bridge] error handling request:", err);
            }
            send({ id, ok: false, code, error });
        });
    };
    const announce = (type) => {
        send({
            type,
            ...(type === "hello" ? { protocol: PROTOCOL_VERSION, version: VERSION } : {}),
            ...pageInfo(),
        });
    };
    const onFocus = () => {
        markActive();
        announce("active");
    };
    const onVisibility = () => {
        const doc = globalThis.document;
        if (doc?.visibilityState === "visible")
            onFocus();
    };
    const target = globalThis;
    target.addEventListener?.("focus", onFocus);
    target.document?.addEventListener?.("visibilitychange", onVisibility);
    const connect = () => {
        if (disposed)
            return;
        const sep = url.includes("?") ? "&" : "?";
        const socket = new WebSocket(`${url}${sep}role=browser&v=${PROTOCOL_VERSION}`);
        ws = socket;
        socket.onopen = () => {
            console.log(`[Devtools Bridge] connected to ${url}`);
            announce("hello");
        };
        socket.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (typeof msg.id !== "string" || typeof msg.type !== "string")
                return;
            const { id, type } = msg;
            const params = (msg.params ?? {});
            respond(id, () => handleRequest(type, params));
        };
        socket.onclose = (event) => {
            if (ws === socket)
                ws = null;
            if (disposed)
                return;
            if (FATAL_CLOSE_CODES.has(event.code)) {
                console.warn(`[Devtools Bridge] relay refused the connection (${event.code}): ${event.reason || "no reason given"} — not reconnecting.`);
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
        close: () => {
            disposed = true;
            if (reconnectTimer)
                clearTimeout(reconnectTimer);
            target.removeEventListener?.("focus", onFocus);
            target.document?.removeEventListener?.("visibilitychange", onVisibility);
            ws?.close();
        },
    };
};
/**
 * Connects to the relay. Safe to call from several places (one per sketch,
 * component, route…): calls with the same target share one socket, which
 * closes shortly after the last disposer ran.
 */
export const connectDevtools = (options) => {
    installGlobal();
    if (typeof WebSocket === "undefined") {
        console.warn("[Devtools Bridge] no WebSocket implementation in this environment — not connecting.");
        return () => false;
    }
    const url = resolveRelayUrl(options, globalThis.location);
    let conn = connections.get(url);
    if (!conn) {
        conn = open(url);
        connections.set(url, conn);
    }
    if (conn.closeTimer) {
        clearTimeout(conn.closeTimer);
        conn.closeTimer = null;
    }
    conn.refs++;
    const mine = conn;
    let disposed = false;
    return () => {
        if (disposed)
            return false;
        disposed = true;
        if (--mine.refs > 0)
            return true;
        mine.closeTimer = setTimeout(() => {
            mine.closeTimer = null;
            if (mine.refs > 0)
                return;
            mine.close();
            if (connections.get(url) === mine)
                connections.delete(url);
        }, CLOSE_GRACE_MS);
        return true;
    };
};
