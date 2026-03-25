// JSON serializer that replaces non-serializable values with placeholders
const isPlainObject = (val) => val !== null &&
    typeof val === "object" &&
    (Object.getPrototypeOf(val) === Object.prototype ||
        Object.getPrototypeOf(val) === null);
const replacer = (seen) => (_key, value) => {
    if (value === null || value === undefined)
        return value;
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
        if (seen.has(value)) {
            return "[non-serializable: circular]";
        }
        seen.add(value);
        if (Array.isArray(value))
            return value;
        if (isPlainObject(value))
            return value;
        const ctorName = value.constructor?.name ?? "object";
        return `[non-serializable: ${ctorName}]`;
    }
    return `[non-serializable: ${typeof value}]`;
};
export const safeSerialize = (value) => {
    const seen = new WeakSet();
    return JSON.stringify(value, replacer(seen));
};
export const safeSerializeValue = (value) => {
    if (value === undefined)
        return null;
    return JSON.parse(safeSerialize(value));
};
//# sourceMappingURL=safe-serialize.js.map