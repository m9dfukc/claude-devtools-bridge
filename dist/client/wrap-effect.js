// Wraps external calls (fetch, storage, APIs) as observable effects.
// Effects do not snapshot state — they log args, result or error, and duration.
import { addLogEntry, currentFrame, inFlightNames } from "./action-registry.js";
import { safeSerializeValue } from "./safe-serialize.js";
import { clip } from "./summarize.js";
import { isThenable } from "./wrap-action.js";
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
export const wrapEffect = (name, fn) => {
    const wrapped = function (...args) {
        const parent = currentFrame();
        const during = inFlightNames();
        const startedAt = Date.now();
        const t0 = now();
        const record = (isAsync, result, error) => {
            try {
                const entry = {
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
            }
            catch (err) {
                console.warn("[Devtools Bridge] logging failed:", err);
            }
        };
        let result;
        try {
            result = fn.apply(this, args);
        }
        catch (err) {
            record(false, undefined, err ?? "undefined");
            throw err;
        }
        if (isThenable(result)) {
            return result.then((resolved) => {
                record(true, resolved);
                return resolved;
            }, (err) => {
                record(true, undefined, err ?? "undefined");
                throw err;
            });
        }
        record(false, result);
        return result;
    };
    return wrapped;
};
