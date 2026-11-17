import { type Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { type RelayStatus } from "../shared/protocol.js";
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
/**
 * Mounts the relay on an existing HTTP(S) server (Vite, Express, …).
 * Only upgrade requests for the relay path are handled, so other WebSocket
 * servers on the same HTTP server (HMR, socket.io, …) keep working.
 */
export declare const createRelay: (httpServer: HttpServer, options?: RelayOptions) => Relay;
/** Standalone mode — creates its own HTTP server for the relay. */
export declare const createStandaloneRelay: (port: number, options?: StandaloneRelayOptions) => Relay;
/**
 * Attaches the relay to a WebSocketServer you manage yourself. You are
 * responsible for routing only the relay path to it.
 */
export declare const createRelayFromWss: (wss: WebSocketServer, options?: RelayOptions | number) => Relay;
