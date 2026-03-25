// Wraps external calls (fetch, storage, APIs) as observable effects that get logged

import { addLogEntry } from "./action-registry";
import { safeSerializeValue } from "./safe-serialize";
import type { LogEntry } from "./types";

/**
 * Wraps an external call (fetch, localStorage, API) so it appears in logs.
 * Unlike wrapAction, effects don't snapshot atom state — they log args, result/error, and duration.
 */
export const wrapEffect = <A extends readonly unknown[], R>(
    name: string,
    fn: (...args: A) => R,
): ((...args: A) => R) => {
    const wrapped = (...args: A): R => {
        const start = performance.now();
        let result: R;

        try {
            result = fn(...args);
        } catch (err) {
            const duration = performance.now() - start;
            addLogEntry(buildEffectEntry(name, args, undefined, String(err), duration));
            throw err;
        }

        // Handle async effects
        if (result instanceof Promise) {
            return result.then((resolved) => {
                const duration = performance.now() - start;
                addLogEntry(buildEffectEntry(name, args, resolved, undefined, duration));
                return resolved;
            }).catch((err: unknown) => {
                const duration = performance.now() - start;
                addLogEntry(buildEffectEntry(name, args, undefined, String(err), duration));
                throw err;
            }) as R;
        }

        const duration = performance.now() - start;
        addLogEntry(buildEffectEntry(name, args, result, undefined, duration));
        return result;
    };
    return wrapped;
};

const buildEffectEntry = (
    name: string,
    args: readonly unknown[],
    result: unknown,
    error: string | undefined,
    duration: number,
): LogEntry => {
    const entry: LogEntry = {
        action: name,
        timestamp: Date.now(),
        kind: "effect",
        diffs: [],
        duration: Math.round(duration * 100) / 100,
        args: safeSerializeValue(args),
    };
    if (error !== undefined) {
        return { ...entry, error };
    }
    if (result !== undefined) {
        return { ...entry, result: safeSerializeValue(result) };
    }
    return entry;
};
