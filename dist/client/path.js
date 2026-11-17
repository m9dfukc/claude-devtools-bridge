// Path addressing inside a state container: "items[3].title", "items.3.title",
// `user["first name"]`. setIn copies along the path so immutable stores see
// new references.
export const parsePath = (path) => {
    const tokens = [];
    const re = /\[\s*(?:(\d+)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\]|([^.[\]]+)/g;
    let m;
    let consumed = 0;
    while ((m = re.exec(path)) !== null) {
        const between = path.slice(consumed, m.index);
        if (between.replace(/\./g, "") !== "")
            break;
        consumed = m.index + m[0].length;
        if (m[1] !== undefined)
            tokens.push(Number(m[1]));
        else if (m[2] !== undefined)
            tokens.push(m[2].replace(/\\(.)/g, "$1"));
        else if (m[3] !== undefined)
            tokens.push(m[3].replace(/\\(.)/g, "$1"));
        else if (m[4] !== undefined)
            tokens.push(m[4]);
    }
    if (path.slice(consumed).replace(/\./g, "") !== "") {
        throw new Error(`Cannot parse path "${path}" near "${path.slice(consumed)}"`);
    }
    return tokens;
};
const IDENT = /^[A-Za-z_$][\w$]*$/;
export const joinPath = (base, token) => {
    if (typeof token === "number")
        return `${base}[${token}]`;
    if (IDENT.test(token))
        return base ? `${base}.${token}` : token;
    return `${base}[${JSON.stringify(token)}]`;
};
const isPlainObject = (v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v))
        return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
};
const asIndex = (token) => {
    if (typeof token === "number")
        return token;
    return /^\d+$/.test(token) ? Number(token) : undefined;
};
const describeKeys = (v) => {
    const keys = Object.keys(v);
    return keys.length === 0
        ? "(no keys)"
        : keys.slice(0, 30).join(", ") + (keys.length > 30 ? ", …" : "");
};
export const getIn = (root, tokens) => {
    let cur = root;
    let at = "";
    for (const token of tokens) {
        if (Array.isArray(cur)) {
            const i = asIndex(token);
            if (i === undefined) {
                throw new Error(`"${at || "(root)"}" is an array (length ${cur.length}) — expected a numeric index, got "${token}"`);
            }
            if (i >= cur.length) {
                throw new Error(`Index ${i} is out of range at "${at || "(root)"}" (length ${cur.length})`);
            }
            cur = cur[i];
        }
        else if (cur !== null && typeof cur === "object") {
            const obj = cur;
            const key = String(token);
            if (!(key in obj)) {
                throw new Error(`No key "${key}" at "${at || "(root)"}". Available: ${describeKeys(obj)}`);
            }
            cur = obj[key];
        }
        else {
            throw new Error(`Cannot read "${token}" at "${at || "(root)"}" — value there is ${cur === null ? "null" : typeof cur}`);
        }
        at = joinPath(at, token);
    }
    return cur;
};
/** Returns a copy of `root` with the value at `tokens` replaced. Parents must exist. */
export const setIn = (root, tokens, value, at = "") => {
    if (tokens.length === 0)
        return value;
    const [token, ...rest] = tokens;
    if (Array.isArray(root)) {
        const i = asIndex(token);
        if (i === undefined) {
            throw new Error(`"${at || "(root)"}" is an array — expected a numeric index, got "${token}"`);
        }
        if (i > root.length) {
            throw new Error(`Index ${i} is out of range at "${at || "(root)"}" (length ${root.length}; use ${root.length} to append)`);
        }
        if (rest.length > 0 && i === root.length) {
            throw new Error(`Index ${i} does not exist at "${at || "(root)"}" (length ${root.length})`);
        }
        const copy = root.slice();
        copy[i] = setIn(root[i], rest, value, joinPath(at, i));
        return copy;
    }
    if (isPlainObject(root)) {
        const key = String(token);
        if (rest.length > 0 && !(key in root)) {
            throw new Error(`No key "${key}" at "${at || "(root)"}". Available: ${describeKeys(root)}`);
        }
        return { ...root, [key]: setIn(root[key], rest, value, joinPath(at, key)) };
    }
    const kind = root === null ? "null" : typeof root === "object" ? "a non-plain object" : typeof root;
    throw new Error(`Cannot set "${token}" at "${at || "(root)"}" — value there is ${kind}`);
};
