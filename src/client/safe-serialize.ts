// JSON serializer that replaces non-serializable values with placeholders

const isPlainObject = (val: unknown): val is Record<string, unknown> =>
    val !== null &&
    typeof val === "object" &&
    (Object.getPrototypeOf(val) === Object.prototype ||
        Object.getPrototypeOf(val) === null);

const replacer = (seen: WeakSet<object>) => (_key: string, value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return value;
    }
    if (typeof value === "function") {
        return `[non-serializable: function]`;
    }
    if (typeof value === "symbol") {
        return `[non-serializable: symbol]`;
    }
    if (typeof value === "bigint") {
        return `[non-serializable: bigint(${value})]`;
    }
    if (typeof value === "object") {
        if (seen.has(value as object)) {
            return "[non-serializable: circular]";
        }
        seen.add(value as object);

        if (Array.isArray(value)) return value;
        if (isPlainObject(value)) return value;

        const ctorName = (value as object).constructor?.name ?? "object";
        return `[non-serializable: ${ctorName}]`;
    }
    return `[non-serializable: ${typeof value}]`;
};

export const safeSerialize = (value: unknown): string => {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, replacer(seen));
};

export const safeSerializeValue = (value: unknown): unknown => {
    if (value === undefined) return null;
    return JSON.parse(safeSerialize(value));
};
