// Wraps external calls (fetch, storage, APIs) as observable effects.
// Effects do not snapshot state — they log args, result or error, and duration.

import type { LogEntry } from "../shared/protocol.js";
import { addLogEntry, currentFrame, inFlightNames } from "./action-registry.js";
import { safeSerializeValue } from "./safe-serialize.js";
import { clip } from "./summarize.js";
import { isThenable } from "./wrap-action.js";

const now = (): number =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

export const wrapEffect = <A extends readonly unknown[], R>(
    name: string,
    fn: (...args: A) => R,
): ((...args: A) => R) => {
    const wrapped = function (this: unknown, ...args: A): R {
        const parent = currentFrame();
        const during = inFlightNames();
        const startedAt = Date.now();
        const t0 = now();

        const record = (isAsync: boolean, result: unknown, error?: unknown): void => {
            try {
                const entry: LogEntry = {
                    action: name,
                    kind: "effect",
                    timestamp: startedAt,
                    duration: Math.round((now() - t0) * 100) / 100,
                    diffs: [],
                    args: clip(safeSerializeValue(args)),
                    ...(isAsync ? { async: true } : {}),
                    ...(error !== undefined
                        ? { error: String(error) }
                        : result !== undefined
                          ? { result: clip(safeSerializeValue(result)) }
                          : {}),
                };
                addLogEntry(entry, parent, during);
            } catch (err) {
                console.warn("[Devtools Bridge] logging failed:", err);
            }
        };

        let result: R;
        try {
            result = fn.apply(this, args as unknown as unknown[] as never) as R;
        } catch (err) {
            record(false, undefined, err ?? "undefined");
            throw err;
        }

        if (isThenable(result)) {
            return result.then(
                (resolved) => {
                    record(true, resolved);
                    return resolved;
                },
                (err: unknown) => {
                    record(true, undefined, err ?? "undefined");
                    throw err;
                },
            ) as R;
        }

        record(false, result);
        return result;
    };
    return wrapped;
};
