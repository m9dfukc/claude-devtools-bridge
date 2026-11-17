import assert from "node:assert/strict";
import { test } from "node:test";
import { safeSerializeValue } from "../src/client/safe-serialize.js";
import { clip, fitToBudget, prettyLength, summarize } from "../src/client/summarize.js";

test("shared references are serialized in full, only real cycles are marked", () => {
    const item = { id: 1, name: "Widget" };
    assert.deepEqual(safeSerializeValue({ selected: item, items: [item, item] }), {
        selected: item,
        items: [item, item],
    });

    const node: Record<string, unknown> = { name: "a" };
    node["self"] = node;
    assert.deepEqual(safeSerializeValue(node), { name: "a", self: "[non-serializable: circular]" });
});

test("Map, Set, typed arrays, Date and class instances keep their content", () => {
    class Vec {
        constructor(
            public x: number,
            public y: number,
        ) {}
    }
    const out = safeSerializeValue({
        m: new Map([["a", 1]]),
        s: new Set([1, 2]),
        f: new Float32Array([1, 2, 3]),
        d: new Date(0),
        v: new Vec(1, 2),
        big: new Uint8Array(100),
    }) as Record<string, Record<string, unknown>>;
    assert.deepEqual(out["m"], { $type: "Map", entries: [["a", 1]] });
    assert.deepEqual(out["s"], { $type: "Set", values: [1, 2] });
    assert.deepEqual(out["f"], { $type: "Float32Array", length: 3, values: [1, 2, 3] });
    assert.equal(out["d"], "1970-01-01T00:00:00.000Z");
    assert.deepEqual(out["v"], { $type: "Vec", x: 1, y: 2 });
    assert.equal(out["big"]!["length"], 100);
    assert.equal((out["big"]!["values"] as unknown[]).length, 64);
    assert.equal(out["big"]!["truncated"], true);
});

test("non-JSON values become placeholders and nothing throws", () => {
    const hostile = {
        get boom(): never {
            throw new Error("nope");
        },
        fn: () => 1,
        sym: Symbol("x"),
        big: 10n,
        nan: NaN,
        undef: undefined,
        list: [undefined, () => 1],
    };
    assert.deepEqual(safeSerializeValue(hostile), {
        boom: "[getter threw: Error: nope]",
        fn: "[non-serializable: function]",
        sym: "[non-serializable: symbol]",
        big: "[bigint: 10]",
        nan: "[NaN]",
        list: [null, "[non-serializable: function]"],
    });
    assert.equal(safeSerializeValue(undefined), null);
});

test("summarize collapses depth, long arrays and long strings", () => {
    const value = { a: { b: { c: 1 } }, list: [1, 2, 3, 4, 5], text: "x".repeat(50) };
    assert.deepEqual(summarize(value, { depth: 1, maxItems: 2, maxString: 10 }), {
        a: "{… 1 keys: b}",
        list: "[… 5 items]",
        text: "xxxxxxxxxx… (+40 chars)",
    });
    assert.deepEqual(summarize([1, 2, 3], { depth: 2, maxItems: 2, maxString: 10 }), [1, 2, "… +1 more items"]);
});

test("fitToBudget returns the value untouched when it fits, a summary with a note otherwise", () => {
    const small = { a: 1 };
    assert.deepEqual(fitToBudget(small, 1000), { value: small });

    const big = { items: Array.from({ length: 300 }, (_, i) => ({ id: i, title: `Item ${i}`, done: false })) };
    const fitted = fitToBudget(big, 2000);
    assert.ok(prettyLength(fitted.value) <= 2000);
    assert.match(fitted.truncated ?? "", /full value is \d+ chars/);

    assert.ok(JSON.stringify(clip(big, 500)).length <= 600);
});
