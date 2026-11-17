export type PathToken = string | number;
export declare const parsePath: (path: string) => PathToken[];
export declare const joinPath: (base: string, token: PathToken) => string;
export declare const getIn: (root: unknown, tokens: ReadonlyArray<PathToken>) => unknown;
/** Returns a copy of `root` with the value at `tokens` replaced. Parents must exist. */
export declare const setIn: (root: unknown, tokens: ReadonlyArray<PathToken>, value: unknown, at?: string) => unknown;
