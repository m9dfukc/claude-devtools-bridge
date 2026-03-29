import type { DisposeFn } from "./types";
export interface ConnectOptions {
    readonly port?: number;
    readonly path?: string;
}
export declare const connectDevtools: (options?: ConnectOptions) => DisposeFn;
//# sourceMappingURL=devtools-client.d.ts.map