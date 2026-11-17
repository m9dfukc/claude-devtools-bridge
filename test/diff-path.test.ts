import assert from "node:assert/strict";
import { test } from "node:test";
import { diffValues } from "../src/client/diff.js";
import { getIn, parsePath, setIn } from "../src/client/path.js";

test("diff reports path-level changes instead of whole snapshots", () => {
    const before = { count: 0, user: { name: "a", tmp: 1 }, items: [{ id: 1, done: false }] };
    const after = { count: 1, user: { name: "a" }, items: [{ id: 1, done: true }, { id: 2, done: false }] };
    assert.deepEqual(diffValues(before, after), {
        truncated: false,
        changes: [
            { path: "count", op: "set", before: 0, after: 1 },
            { path: "user.tmp", op: "remove", before: 1 },
            { path: "items[0].done", op: "set", before: false, after: true },
            { path: "items[1]", op: "add", after: { id: 2, done: false } },
        ],
    });
});

test("identical references are not descended into", () => {
    let reads = 0;
    const shared = {
        get expensive(): number {
            reads++;
            return 1;
        },
    };
    const { changes } = diffValues({ shared, n: 1 }, { shared, n: 2 });
    assert.deepEqual(changes, [{ path: "n", op: "set", before: 1, after: 2 }]);
    assert.equal(reads, 0);
});

test("root replacement, odd keys and the change cap", () => {
    assert.deepEqual(diffValues(1, "1").changes, [{ path: "", op: "set", before: 1, after: "1" }]);
    assert.deepEqual(diffValues({ "a b": 1 }, { "a b": 2 }).changes, [
        { path: '["a b"]', op: "set", before: 1, after: 2 },
    ]);
    assert.deepEqual(diffValues({ a: 1 }, { a: 1 }).changes, []);
    assert.deepEqual(diffValues(new Map([["a", 1]]), new Map([["a", 1]])).changes, []);

    assert.deepEqual(diffValues({ list: [1, 2, 3, 4, 5, 6] }, { list: [1] }).changes, [
        { path: "list[1…5]", op: "remove", count: 5, before: 2 },
    ]);

    const many = diffValues(
        Array.from({ length: 200 }, (_, i) => i),
        Array.from({ length: 200 }, (_, i) => i + 1),
    );
    assert.equal(many.changes.length, 50);
    assert.equal(many.truncated, true);
});

test("parsePath understands dots, indices and quoted keys", () => {
    assert.deepEqual(parsePath("items[3].title"), ["items", 3, "title"]);
    assert.deepEqual(parsePath("items.3.title"), ["items", "3", "title"]);
    assert.deepEqual(parsePath('user["first name"].x'), ["user", "first name", "x"]);
    assert.deepEqual(parsePath(""), []);
    assert.throws(() => parsePath("a[b"), /Cannot parse path/);
});

test("getIn explains what is missing", () => {
    const state = { user: { name: "a" }, items: [{ id: 1 }] };
    assert.equal(getIn(state, parsePath("items[0].id")), 1);
    assert.equal(getIn(state, parsePath("items.0.id")), 1);
    assert.throws(() => getIn(state, parsePath("user.nmae")), /No key "nmae" at "user"\. Available: name/);
    assert.throws(() => getIn(state, parsePath("items[4]")), /Index 4 is out of range at "items" \(length 1\)/);
    assert.throws(() => getIn(state, parsePath("user.name.first")), /value there is string/);
});

test("setIn copies along the path and leaves the rest shared", () => {
    const state = { user: { name: "a" }, items: [{ id: 1 }, { id: 2 }], other: { big: true } };
    const next = setIn(state, parsePath("items[1].id"), 9) as typeof state;
    assert.deepEqual(next.items, [{ id: 1 }, { id: 9 }]);
    assert.equal(state.items[1]!.id, 2, "original untouched");
    assert.notEqual(next.items, state.items);
    assert.equal(next.other, state.other, "untouched branch keeps its reference");
    assert.equal(next.items[0], state.items[0]);

    assert.deepEqual(setIn({ a: {} }, ["a", "fresh"], 1), { a: { fresh: 1 } });
    assert.deepEqual(setIn([1], [1], 2), [1, 2]);
    assert.throws(() => setIn({ a: {} }, ["missing", "x"], 1), /No key "missing"/);
    assert.throws(() => setIn({ a: 1 }, ["a", "x"], 1), /value there is number/);
});
