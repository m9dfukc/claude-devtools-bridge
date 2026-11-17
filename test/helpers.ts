import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, type ClientOptions } from "ws";
import { createRelay, type Relay, type RelayOptions } from "../src/relay/ws-relay.js";

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface TestRelay {
    readonly relay: Relay;
    readonly server: Server;
    readonly port: number;
    readonly url: string;
    close(): Promise<void>;
}

/** Relay on a random free port, with console output silenced. */
export const startRelay = async (options: RelayOptions = {}): Promise<TestRelay> => {
    const server = createServer();
    const relay = silenced(() => createRelay(server, { discovery: false, ...options }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    return {
        relay,
        server,
        port,
        url: `ws://127.0.0.1:${port}/devtools-bridge`,
        close: () =>
            new Promise<void>((r) => {
                relay.close();
                server.close(() => r());
                server.closeAllConnections();
            }),
    };
};

export const silenced = <T>(fn: () => T): T => {
    const { log, warn } = console;
    console.log = () => {};
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.log = log;
        console.warn = warn;
    }
};

export interface Peer {
    readonly ws: WebSocket;
    readonly messages: Array<Record<string, unknown>>;
    /** Resolves with the next message matching `pred`. */
    next(pred?: (m: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
    send(data: unknown): void;
    closed: Promise<{ code: number; reason: string }>;
}

export const connect = async (url: string, options: ClientOptions = {}): Promise<Peer> => {
    const ws = new WebSocket(url, options);
    const messages: Array<Record<string, unknown>> = [];
    const waiters: Array<{ pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }> = [];
    ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const i = waiters.findIndex((w) => w.pred(msg));
        if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg);
        else messages.push(msg);
    });
    const closed = new Promise<{ code: number; reason: string }>((r) =>
        ws.on("close", (code, reason) => r({ code, reason: reason.toString() })),
    );
    ws.on("error", () => {});
    await new Promise<void>((resolve) => {
        ws.once("open", () => resolve());
        ws.once("close", () => resolve());
    });
    return {
        ws,
        messages,
        closed,
        send: (data) => ws.send(JSON.stringify(data)),
        next: (pred = () => true, timeoutMs = 2000) => {
            const i = messages.findIndex(pred);
            if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]!);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
                waiters.push({
                    pred,
                    resolve: (m) => {
                        clearTimeout(timer);
                        resolve(m);
                    },
                });
            });
        },
    };
};

export const mcpUrl = (url: string, extra = ""): string => `${url}?role=mcp&v=2${extra}`;
export const browserUrl = (url: string, extra = ""): string => `${url}?role=browser&v=2${extra}`;
