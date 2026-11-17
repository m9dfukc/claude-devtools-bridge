// Structural diff between two values, reported as a list of path-level changes.
// Identical references are skipped without descending, so immutable state
// (structural sharing) diffs in time proportional to what actually changed.
import { joinPath } from "./path.js";
import { safeSerialize, safeSerializeValue } from "./safe-serialize.js";
import { clip } from "./summarize.js";
const MAX_CHANGES = 50;
const MAX_DEPTH = 16;
const MAX_TAIL_ITEMS = 3;
const isPlainObject = (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
const leafEqual = (a, b) => {
    const aObj = a !== null && typeof a === "object";
    const bObj = b !== null && typeof b === "object";
    if (!aObj || !bObj)
        return false; // Object.is already ruled out equal primitives
    return safeSerialize(a) === safeSerialize(b);
};
const stored = (v) => clip(safeSerializeValue(v));
export const diffValues = (before, after, maxChanges = MAX_CHANGES) => {
    const changes = [];
    let truncated = false;
    const push = (c) => {
        if (changes.length >= maxChanges)
            truncated = true;
        else
            changes.push(c);
    };
    /** Items an array gained or lost at its end — summarized when there are many. */
    const tail = (path, from, arr, op) => {
        const count = arr.length - from;
        if (count <= 0 || truncated)
            return;
        const key = op === "add" ? "after" : "before";
        if (count <= MAX_TAIL_ITEMS) {
            for (let i = from; i < arr.length; i++) {
                push({ path: joinPath(path, i), op, [key]: stored(arr[i]) });
            }
            return;
        }
        push({
            path: `${path}[${from}…${arr.length - 1}]`,
            op,
            count,
            [key]: clip(safeSerializeValue(arr[from]), 200),
        });
    };
    const rec = (a, b, path, depth) => {
        if (truncated || Object.is(a, b))
            return;
        if (depth < MAX_DEPTH && Array.isArray(a) && Array.isArray(b)) {
            const shared = Math.min(a.length, b.length);
            for (let i = 0; i < shared && !truncated; i++) {
                rec(a[i], b[i], joinPath(path, i), depth + 1);
            }
            tail(path, shared, b, "add");
            tail(path, shared, a, "remove");
            return;
        }
        if (depth < MAX_DEPTH && isPlainObject(a) && isPlainObject(b)) {
            for (const key of Object.keys(a)) {
                if (truncated)
                    return;
                if (key in b)
                    rec(a[key], b[key], joinPath(path, key), depth + 1);
                else
                    push({ path: joinPath(path, key), op: "remove", before: stored(a[key]) });
            }
            for (const key of Object.keys(b)) {
                if (truncated)
                    return;
                if (!(key in a))
                    push({ path: joinPath(path, key), op: "add", after: stored(b[key]) });
            }
            return;
        }
        if (!leafEqual(a, b)) {
            push({ path, op: "set", before: stored(a), after: stored(b) });
        }
    };
    rec(before, after, "", 0);
    return { changes, truncated };
};
