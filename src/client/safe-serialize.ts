// Converts arbitrary runtime values into plain JSON-safe data.
// Never throws; non-serializable parts become readable placeholders.

const MAX_NODES = 200_000;
const MAX_DEPTH = 64;
const TYPED_ARRAY_PREVIEW = 64;

interface Ctx {
    /** Objects on the current path — a repeat here is a real cycle. */
    readonly ancestors: Set<object>;
    nodes: number;
}

const ctorName = (obj: object): string => {
    try {
        return (obj as { constructor?: { name?: string } }).constructor?.name || "Object";
    } catch {
        return "Object";
    }
};

const walk = (value: unknown, ctx: Ctx, depth: number): unknown => {
    if (value === null) return null;
    switch (typeof value) {
        case "undefined":
            return undefined;
        case "boolean":
        case "string":
            return value;
        case "number":
            return Number.isFinite(value) ? value : `[${String(value)}]`;
        case "bigint":
            return `[bigint: ${value}]`;
        case "function":
            return "[non-serializable: function]";
        case "symbol":
            return "[non-serializable: symbol]";
    }

    const obj = value as object;
    if (ctx.ancestors.has(obj)) return "[non-serializable: circular]";
    if (++ctx.nodes > MAX_NODES) return "[truncated: value too large]";
    if (depth > MAX_DEPTH) return "[truncated: nesting too deep]";

    if (obj instanceof Date) {
        return Number.isNaN(obj.getTime()) ? "[Invalid Date]" : obj.toISOString();
    }
    if (obj instanceof RegExp) return String(obj);
    if (obj instanceof Error) {
        return { $type: obj.name || "Error", message: obj.message };
    }
    if (typeof Node !== "undefined" && obj instanceof Node) {
        return `[non-serializable: ${ctorName(obj)}]`;
    }
    if (ArrayBuffer.isView(obj)) {
        if (obj instanceof DataView) {
            return { $type: "DataView", byteLength: obj.byteLength };
        }
        const arr = obj as unknown as ArrayLike<number | bigint>;
        const n = Math.min(arr.length, TYPED_ARRAY_PREVIEW);
        const values: unknown[] = [];
        for (let i = 0; i < n; i++) values.push(walk(arr[i], ctx, depth + 1));
        return {
            $type: ctorName(obj),
            length: arr.length,
            values,
            ...(arr.length > n ? { truncated: true } : {}),
        };
    }
    if (obj instanceof ArrayBuffer) {
        return { $type: "ArrayBuffer", byteLength: obj.byteLength };
    }
    if (obj instanceof Promise || obj instanceof WeakMap || obj instanceof WeakSet) {
        return `[non-serializable: ${ctorName(obj)}]`;
    }

    ctx.ancestors.add(obj);
    try {
        if (Array.isArray(obj)) {
            return obj.map((item) => {
                const r = walk(item, ctx, depth + 1);
                return r === undefined ? null : r;
            });
        }
        if (obj instanceof Map) {
            return {
                $type: "Map",
                entries: [...obj].map(([k, v]) => [
                    walk(k, ctx, depth + 1) ?? null,
                    walk(v, ctx, depth + 1) ?? null,
                ]),
            };
        }
        if (obj instanceof Set) {
            return {
                $type: "Set",
                values: [...obj].map((v) => walk(v, ctx, depth + 1) ?? null),
            };
        }
        const toJSON = (obj as { toJSON?: unknown }).toJSON;
        if (typeof toJSON === "function") {
            try {
                return walk(toJSON.call(obj), ctx, depth + 1);
            } catch (err) {
                return `[toJSON threw: ${String(err)}]`;
            }
        }

        const out: Record<string, unknown> = {};
        const proto = Object.getPrototypeOf(obj);
        if (proto !== Object.prototype && proto !== null) {
            const name = ctorName(obj);
            if (name !== "Object") out["$type"] = name;
        }
        for (const key of Object.keys(obj)) {
            let v: unknown;
            try {
                v = (obj as Record<string, unknown>)[key];
            } catch (err) {
                v = `[getter threw: ${String(err)}]`;
            }
            const r = walk(v, ctx, depth + 1);
            if (r !== undefined) out[key] = r;
        }
        return out;
    } finally {
        ctx.ancestors.delete(obj);
    }
};

/** Plain JSON-safe copy of `value`. `undefined` becomes `null`. */
export const safeSerializeValue = (value: unknown): unknown => {
    const r = walk(value, { ancestors: new Set(), nodes: 0 }, 0);
    return r === undefined ? null : r;
};

export const safeSerialize = (value: unknown): string =>
    JSON.stringify(safeSerializeValue(value));
