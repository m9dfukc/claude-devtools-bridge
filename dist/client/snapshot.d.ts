import type { StateDiff } from "../shared/protocol.js";
interface Snap {
    readonly value: unknown;
    readonly error?: string;
}
export type Snapshot = Map<string, Snap>;
/** Deep copy that never throws. */
export declare const cloneValue: (value: unknown) => unknown;
export declare const snapshotAtoms: () => Snapshot;
export declare const diffSnapshots: (before: Snapshot, after: Snapshot) => StateDiff[];
export {};
