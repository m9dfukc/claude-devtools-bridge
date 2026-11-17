import type { Change } from "../shared/protocol.js";
export interface DiffResult {
    readonly changes: Change[];
    readonly truncated: boolean;
}
export declare const diffValues: (before: unknown, after: unknown, maxChanges?: number) => DiffResult;
