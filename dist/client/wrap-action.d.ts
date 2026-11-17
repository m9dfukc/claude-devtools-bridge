import type { ActionFn } from "./types.js";
export declare const isThenable: (v: unknown) => v is PromiseLike<unknown>;
export declare const wrapAction: <F extends ActionFn>(name: string, fn: F) => F;
