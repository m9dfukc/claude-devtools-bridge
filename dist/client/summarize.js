// Shrinks plain JSON data so it fits a character budget, keeping the shape
// readable: deep levels collapse to "{…}" markers, long arrays and strings
// are cut with an explicit "+N more" marker.
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const collapsed = (v) => {
    if (Array.isArray(v))
        return `[… ${v.length} items]`;
    if (isObject(v)) {
        const keys = Object.keys(v);
        const shown = keys.slice(0, 8).join(", ");
        return `{… ${keys.length} keys: ${shown}${keys.length > 8 ? ", …" : ""}}`;
    }
    return v;
};
export const summarize = (value, opts) => {
    if (typeof value === "string") {
        return value.length > opts.maxString
            ? `${value.slice(0, opts.maxString)}… (+${value.length - opts.maxString} chars)`
            : value;
    }
    if (value === null || typeof value !== "object")
        return value;
    if (opts.depth <= 0)
        return collapsed(value);
    const next = { ...opts, depth: opts.depth - 1 };
    if (Array.isArray(value)) {
        const head = value.slice(0, opts.maxItems).map((v) => summarize(v, next));
        if (value.length > opts.maxItems) {
            head.push(`… +${value.length - opts.maxItems} more items`);
        }
        return head;
    }
    const out = {};
    for (const [k, v] of Object.entries(value))
        out[k] = summarize(v, next);
    return out;
};
const LEVELS = [
    { depth: Infinity, maxItems: 50, maxString: 2000 },
    { depth: 8, maxItems: 20, maxString: 500 },
    { depth: 6, maxItems: 20, maxString: 500 },
    { depth: 4, maxItems: 10, maxString: 300 },
    { depth: 3, maxItems: 10, maxString: 200 },
    { depth: 2, maxItems: 5, maxString: 200 },
    { depth: 1, maxItems: 5, maxString: 100 },
    { depth: 1, maxItems: 3, maxString: 60 },
];
export const prettyLength = (value) => (JSON.stringify(value, null, 2) ?? "null").length;
/** Returns `value` unchanged if its pretty JSON fits, else the least lossy summary that does. */
export const fitToBudget = (value, maxChars) => {
    const full = prettyLength(value);
    if (full <= maxChars)
        return { value };
    let last = value;
    let lastOpts = LEVELS[0];
    for (const opts of LEVELS) {
        last = summarize(value, opts);
        lastOpts = opts;
        if (prettyLength(last) <= maxChars)
            break;
    }
    const depth = Number.isFinite(lastOpts.depth) ? `depth ${lastOpts.depth}` : "full depth";
    return {
        value: last,
        truncated: `full value is ${full} chars; shown: ${depth}, arrays capped at ${lastOpts.maxItems} items, ` +
            `strings at ${lastOpts.maxString} chars`,
    };
};
/** Compact single value for log storage: full if small, summarized otherwise. */
export const clip = (value, maxChars = 2000) => {
    const s = JSON.stringify(value);
    if (s === undefined || s.length <= maxChars)
        return value;
    return fitToBudget(value, maxChars).value;
};
