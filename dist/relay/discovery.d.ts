export interface DiscoveryRecord {
    readonly protocol: number;
    readonly version: string;
    readonly pid: number;
    readonly port: number;
    readonly secure: boolean;
    readonly path: string;
    readonly root: string;
    readonly startedAt: number;
    /** True when the relay requires a token (the token itself is never written). */
    readonly tokenRequired?: boolean;
}
export declare const DISCOVERY_SUBDIR: string;
export declare const discoveryDir: (root: string) => string;
export declare const isAlive: (pid: number) => boolean;
export declare const readDiscoveryDir: (dir: string) => DiscoveryRecord[];
/** Writes the record and returns a function that removes it again. Never throws. */
export declare const writeDiscovery: (record: DiscoveryRecord) => (() => void);
