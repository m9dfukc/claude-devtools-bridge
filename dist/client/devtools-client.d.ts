import type { DisposeFn } from "./types.js";
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
export declare const resolveRelayUrl: (options?: ConnectOptions, loc?: LocationLike) => string;
/**
 * Connects to the relay. Safe to call from several places (one per sketch,
 * component, route…): calls with the same target share one socket, which
 * closes shortly after the last disposer ran.
 */
export declare const connectDevtools: (options?: ConnectOptions) => DisposeFn;
export {};
