// Wraps an action so each call is logged with the state changes it caused.
// The wrapper is transparent: same arguments, same return value, errors are
// re-thrown unchanged, and a failure inside the logging never reaches the app.

import type { LogEntry } from "../shared/protocol.js";
import {
    addLogEntry,
    closeFrame,
    currentFrame,
    markInFlight,
    openFrame,
    runInFrame,
} from "./action-registry.js";
import { safeSerializeValue } from "./safe-serialize.js";
import { diffSnapshots, snapshotAtoms, type Snapshot } from "./snapshot.js";
import { clip } from "./summarize.js";
import type { ActionFn } from "./types.js";

export const isThenable = (v: unknown): v is PromiseLike<unknown> =>
    v !== null &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function";

const now = (): number =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

const round = (ms: number): number => Math.round(ms * 100) / 100;

const guarded = (fn: () => void): void => {
    try {
        fn();
    } catch (err) {
        console.warn("[Devtools Bridge] logging failed:", err);
    }
};

export const wrapAction = <F extends ActionFn>(name: string, fn: F): F => {
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        const parent = currentFrame();
        const frame = openFrame(name);
        const t0 = now();
        let before: Snapshot = new Map();
        guarded(() => {
            before = snapshotAtoms();
        });

        const finish = (isAsync: boolean, error?: unknown): void => {
            closeFrame(frame);
            guarded(() => {
                const entry: LogEntry = {
                    action: name,
                    kind: "action",
                    timestamp: frame.startedAt,
                    duration: round(now() - t0),
                    diffs: diffSnapshots(before, snapshotAtoms()),
                    ...(isAsync ? { async: true } : {}),
                    ...(args.length > 0 ? { args: clip(safeSerializeValue(args)) } : {}),
                    ...(frame.children.length > 0 ? { children: frame.children } : {}),
                    ...(error !== undefined ? { error: String(error) } : {}),
                };
                addLogEntry(entry, parent, frame.during);
            });
        };

        let result: unknown;
        try {
            result = runInFrame(frame, () => fn.apply(this, args));
        } catch (err) {
            finish(false, err ?? "undefined");
            throw err;
        }

        if (isThenable(result)) {
            markInFlight(frame);
            return result.then(
                (resolved) => {
                    finish(true);
                    return resolved;
                },
                (err: unknown) => {
                    finish(true, err ?? "undefined");
                    throw err;
                },
            );
        }

        finish(false);
        return result;
    };
    return wrapped as unknown as F;
};
