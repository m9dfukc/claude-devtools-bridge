export interface SummarizeOptions {
    readonly depth: number;
    readonly maxItems: number;
    readonly maxString: number;
}
export declare const summarize: (value: unknown, opts: SummarizeOptions) => unknown;
export declare const prettyLength: (value: unknown) => number;
export interface Fitted {
    readonly value: unknown;
    /** Describes what was cut; undefined when the value is complete. */
    readonly truncated?: string;
}
/** Returns `value` unchanged if its pretty JSON fits, else the least lossy summary that does. */
export declare const fitToBudget: (value: unknown, maxChars: number) => Fitted;
/** Compact single value for log storage: full if small, summarized otherwise. */
export declare const clip: (value: unknown, maxChars?: number) => unknown;
