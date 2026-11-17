// Wire protocol shared by browser client, relay and MCP server / CLI.
//
// Topology: browser tabs and MCP-side clients (MCP server, CLI) all connect
// to the relay as WebSocket clients. The relay routes each request from an
// MCP-side client to exactly one browser tab and routes the answer back.
// Nothing is buffered: if no tab can take a request, the relay answers
// immediately with an error.
export const PROTOCOL_VERSION = 2;
export const DEFAULT_PATH = "/devtools-bridge";
export const DEFAULT_PORT = 5173;
/** WebSocket close codes used by the relay. */
export const CLOSE = {
    BAD_ROLE: 4000,
    /** v1 "replaced" code. v1 MCP servers stop reconnecting when they see it. */
    REPLACED: 4001,
    PROTOCOL_MISMATCH: 4002,
    FORBIDDEN: 4003,
};
/** Codes after which a client must not reconnect on its own. */
export const FATAL_CLOSE_CODES = new Set([
    CLOSE.BAD_ROLE,
    CLOSE.REPLACED,
    CLOSE.PROTOCOL_MISMATCH,
    CLOSE.FORBIDDEN,
]);
