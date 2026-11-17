// Wraps an action so each call is logged with the state changes it caused.
// The wrapper is transparent: same arguments, same return value, errors are
// re-thrown unchanged, and a failure inside the logging never reaches the app.
import { addLogEntry, closeFrame, currentFrame, markInFlight, openFrame, runInFrame, } from "./action-registry.js";
import { safeSerializeValue } from "./safe-serialize.js";
import { diffSnapshots, snapshotAtoms } from "./snapshot.js";
import { clip } from "./summarize.js";
export const isThenable = (v) => v !== null &&
    (typeof v === "object" || typeof v === "function") &&
    typeof v.then === "function";
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
const round = (ms) => Math.round(ms * 100) / 100;
const guarded = (fn) => {
    try {
        fn();
    }
    catch (err) {
        console.warn("[Devtools Bridge] logging failed:", err);
    }
};
export const wrapAction = (name, fn) => {
    const wrapped = function (...args) {
        const parent = currentFrame();
        const frame = openFrame(name);
        const t0 = now();
        let before = new Map();
        guarded(() => {
            before = snapshotAtoms();
        });
        const finish = (isAsync, error) => {
            closeFrame(frame);
            guarded(() => {
                const entry = {
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
        let result;
        try {
            result = runInFrame(frame, () => fn.apply(this, args));
        }
        catch (err) {
            finish(false, err ?? "undefined");
            throw err;
        }
        if (isThenable(result)) {
            markInFlight(frame);
            return result.then((resolved) => {
                finish(true);
                return resolved;
            }, (err) => {
                finish(true, err ?? "undefined");
                throw err;
            });
        }
        finish(false);
        return result;
    };
    return wrapped;
};
