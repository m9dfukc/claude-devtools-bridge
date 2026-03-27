import { Server as HttpServer } from "node:http";
import { WebSocketServer } from "ws";
interface RelayOptions {
    readonly path?: string;
    readonly bufferSize?: number;
}
interface Relay {
    close(): void;
}
export declare const createRelayFromWss: (wss: WebSocketServer, bufferSize?: number) => Relay;
/** Mount relay on an existing HTTP server (Vite, Express, etc.) */
export declare const createRelay: (httpServer: HttpServer, options?: RelayOptions) => Relay;
/** Standalone mode — creates its own HTTP server */
export declare const createStandaloneRelay: (port: number, options?: RelayOptions) => Relay;
export {};
//# sourceMappingURL=ws-relay.d.ts.map