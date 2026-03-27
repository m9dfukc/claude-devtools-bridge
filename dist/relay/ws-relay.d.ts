import { Server as HttpServer } from "node:http";
interface RelayOptions {
    readonly path?: string;
    readonly bufferSize?: number;
}
interface Relay {
    close(): void;
}
/** Mount relay on an existing HTTP server (Vite, Express, etc.) */
export declare const createRelay: (httpServer: HttpServer, options?: RelayOptions) => Relay;
/** Standalone mode — creates its own HTTP server */
export declare const createStandaloneRelay: (port: number, options?: RelayOptions) => Relay;
export {};
//# sourceMappingURL=ws-relay.d.ts.map