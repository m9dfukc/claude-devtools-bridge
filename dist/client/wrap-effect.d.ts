/**
 * Wraps an external call (fetch, localStorage, API) so it appears in logs.
 * Unlike wrapAction, effects don't snapshot atom state — they log args, result/error, and duration.
 */
export declare const wrapEffect: <A extends readonly unknown[], R>(name: string, fn: (...args: A) => R) => ((...args: A) => R);
//# sourceMappingURL=wrap-effect.d.ts.map