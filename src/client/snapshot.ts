// Before/after snapshots of all registered containers and their diff.

import type { StateDiff } from "../shared/protocol.js";
import { getRegisteredAtoms } from "./action-registry.js";
import { diffValues } from "./diff.js";
import { safeSerializeValue } from "./safe-serialize.js";

interface Snap {
    readonly value: unknown;
    readonly error?: string;
}

export type Snapshot = Map<string, Snap>;

/** Deep copy that never throws. */
export const cloneValue = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    try {
        return structuredClone(value);
    } catch {
        return safeSerializeValue(value);
    }
};

export const snapshotAtoms = (): Snapshot => {
    const snap: Snapshot = new Map();
    for (const [name, { atom, immutable }] of getRegisteredAtoms()) {
        try {
            const value = atom.deref();
            snap.set(name, { value: immutable ? value : cloneValue(value) });
        } catch (err) {
            snap.set(name, { value: undefined, error: String(err) });
        }
    }
    return snap;
};

export const diffSnapshots = (before: Snapshot, after: Snapshot): StateDiff[] => {
    const diffs: StateDiff[] = [];
    for (const name of new Set([...before.keys(), ...after.keys()])) {
        const b = before.get(name);
        const a = after.get(name);
        if (b?.error !== undefined || a?.error !== undefined) continue;
        if (b === undefined) {
            diffs.push({ atom: name, changes: [{ path: "", op: "add", after: "(registered during the call)" }] });
            continue;
        }
        if (a === undefined) {
            diffs.push({ atom: name, changes: [{ path: "", op: "remove", before: "(unregistered during the call)" }] });
            continue;
        }
        const { changes, truncated } = diffValues(b.value, a.value);
        if (changes.length > 0) {
            diffs.push({ atom: name, changes, ...(truncated ? { truncated } : {}) });
        }
    }
    return diffs;
};
