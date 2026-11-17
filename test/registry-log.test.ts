import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
    getRegisteredAtoms,
    queryLogs,
    registerAction,
    registerAtom,
    registerDerived,
    resetRegistryForTests,
} from "../src/client/action-registry.js";
import { describe, getState, handleRequest, setState, triggerAction } from "../src/client/handlers.js";
import { wrapAction } from "../src/client/wrap-action.js";
import { wrapEffect } from "../src/client/wrap-effect.js";
import { sleep } from "./helpers.js";

const atom = <T>(initial: T) => {
    let value = initial;
    return {
        deref: () => value,
        reset: (v: T) => {
            value = v;
        },
        swap: (fn: (v: T) => T) => {
            value = fn(value);
        },
    };
};

beforeEach(() => resetRegistryForTests());

test("an old disposer does not remove a newer registration under the same name", () => {
    const disposeOld = registerAtom("app", atom({ v: 1 }));
    const disposeNew = registerAtom("app", atom({ v: 2 }));
    assert.equal(disposeOld(), false);
    assert.deepEqual([...getRegisteredAtoms().keys()], ["app"]);
    assert.equal(disposeNew(), true);
    assert.equal(getRegisteredAtoms().size, 0);
    assert.equal(disposeNew(), false);
});

test("wrapAction logs path-level diffs, args and nested sync calls", () => {
    const st = atom({ count: 0, items: [1] });
    registerAtom("app", st);
    const inner = wrapAction("inner", (by: number) => st.swap((s) => ({ ...s, count: s.count + by })));
    const outer = wrapAction("outer", () => {
        inner(2);
        st.swap((s) => ({ ...s, items: [...s.items, 2] }));
        return "done";
    });

    assert.equal(outer(), "done");
    const { entries, lastSeq } = queryLogs();
    assert.equal(entries.length, 1);
    assert.equal(lastSeq, 1);
    const [entry] = entries;
    assert.equal(entry!.action, "outer");
    assert.deepEqual(entry!.diffs, [
        {
            atom: "app",
            changes: [
                { path: "count", op: "set", before: 0, after: 2 },
                { path: "items[1]", op: "add", after: 2 },
            ],
        },
    ]);
    assert.equal(entry!.children?.length, 1);
    assert.equal(entry!.children![0]!.action, "inner");
    assert.deepEqual(entry!.children![0]!.args, [2]);
});

test("the wrapper is transparent: this, return value and thrown errors pass through", () => {
    const obj = {
        factor: 3,
        times: wrapAction("times", function (this: { factor: number }, n: number) {
            return this.factor * n;
        }),
    };
    assert.equal(obj.times(2), 6);

    const boom = wrapAction("boom", () => {
        throw new TypeError("bad");
    });
    assert.throws(() => boom(), TypeError);
    assert.equal(queryLogs().entries.at(-1)!.error, "TypeError: bad");
});

test("overlapping async actions are not nested into each other", async () => {
    const st = atom({ a: 0, b: 0 });
    registerAtom("st", st, { immutable: true });
    const slowA = wrapAction("slowA", async () => {
        await sleep(40);
        st.swap((s) => ({ ...s, a: 1 }));
    });
    const fastB = wrapAction("fastB", async () => {
        await sleep(10);
        st.swap((s) => ({ ...s, b: 1 }));
    });
    const effect = wrapEffect("unrelated", () => 42);

    const pending = [slowA(), fastB()];
    await sleep(20);
    effect();
    await Promise.all(pending);

    const { entries } = queryLogs();
    assert.deepEqual(
        entries.map((e) => e.action),
        ["fastB", "unrelated", "slowA"],
    );
    for (const e of entries) assert.equal(e.children, undefined);
    assert.deepEqual(entries[0]!.during, ["slowA"]);
    assert.deepEqual(entries[1]!.during, ["slowA"]);
    assert.equal(entries[2]!.async, true);
    assert.deepEqual(entries[0]!.diffs[0]!.changes, [{ path: "b", op: "set", before: 0, after: 1 }]);
});

test("a promise that never settles does not swallow later log entries", async () => {
    const hang = wrapAction("hangs", () => new Promise(() => {}));
    void hang();
    wrapAction("later", () => 1)();
    const result = queryLogs();
    assert.deepEqual(
        result.entries.map((e) => e.action),
        ["later"],
    );
    assert.deepEqual(
        result.inFlight.map((f) => f.name),
        ["hangs"],
    );
});

test("a sync child of an async action is attached while the parent's sync part runs", async () => {
    const child = wrapAction("child", () => 1);
    const parent = wrapAction("parent", async () => {
        child();
        await sleep(5);
        child();
    });
    await parent();
    const { entries } = queryLogs();
    assert.deepEqual(
        entries.map((e) => [e.action, e.children?.map((c) => c.action)]),
        [
            ["child", undefined],
            ["parent", ["child"]],
        ],
    );
    assert.deepEqual(entries[0]!.during, ["parent"]);
});

test("logging failures never reach the app", () => {
    registerAtom("bad", {
        deref: () => {
            throw new Error("deref exploded");
        },
        reset: () => {},
    });
    assert.equal(wrapAction("still-works", () => 7)(), 7);
});

test("queryLogs: limit, since and name filter", () => {
    for (const name of ["a.one", "b.two", "a.three", "b.four"]) wrapAction(name, () => 1)();
    assert.deepEqual(queryLogs({ limit: 2 }).entries.map((e) => e.seq), [3, 4]);
    assert.deepEqual(queryLogs({ since: 3 }).entries.map((e) => e.seq), [4]);
    assert.deepEqual(queryLogs({ name: "A." }).entries.map((e) => e.action), ["a.one", "a.three"]);
    assert.equal(queryLogs({ since: 4 }).entries.length, 0);
});

test("get_state: everything, one container, a path, and helpful errors", () => {
    registerAtom("app", atom({ user: { name: "x" }, items: [{ id: 1 }] }));
    registerDerived("app/count", { deref: () => 1 });

    assert.deepEqual(getState().value, {
        app: { user: { name: "x" }, items: [{ id: 1 }] },
        $derived: { "app/count": 1 },
    });
    assert.deepEqual(getState({ name: "app", path: "items[0]" }).value, { id: 1 });
    assert.equal(getState({ name: "app/count" }).value, 1);
    assert.deepEqual(getState({ name: "app", depth: 1 }).value, {
        user: "{… 1 keys: name}",
        items: "[… 1 items]",
    });
    assert.throws(() => getState({ name: "nope" }), /Unknown state container "nope"\. Atoms: app\. Derived: app\/count/);
    assert.throws(() => getState({ name: "app", path: "user.nmae" }), /No key "nmae"/);
    assert.throws(() => getState({ path: "x" }), /"path" needs "name"/);
});

test("get_state shortens large state to the budget and says so", () => {
    registerAtom("big", atom({ items: Array.from({ length: 500 }, (_, i) => ({ id: i, title: `Item ${i}` })) }));
    const result = getState({ maxChars: 3000 });
    assert.ok(JSON.stringify(result.value, null, 2).length <= 3000);
    assert.match(result.truncated ?? "", /Narrow it with name\/path/);
});

test("set_state: whole container, deep path, strict errors, logged", () => {
    const st = atom<unknown>({ user: { name: "x", age: 1 }, list: [1] });
    registerAtom("app", st, { immutable: true });
    registerDerived("total", { deref: () => 1 });

    const deep = setState({ name: "app", path: "user.name", value: "y" });
    assert.deepEqual(deep.changes, [{ path: "user.name", op: "set", before: "x", after: "y" }]);
    assert.deepEqual(st.deref(), { user: { name: "y", age: 1 }, list: [1] });

    const whole = setState({ name: "app", value: { n: 1 } });
    assert.equal(whole.previousType, "object");
    assert.deepEqual(st.deref(), { n: 1 });

    // A string stays a string — nothing is JSON-parsed behind the caller's back.
    const str = setState({ name: "app", value: '{"n":2}' });
    assert.equal(str.newType, "string");
    assert.equal(st.deref(), '{"n":2}');

    assert.throws(() => setState({ name: "total", value: 1 }), /derived \(read-only\)/);
    assert.throws(() => setState({ name: "nope", value: 1 }), /Unknown atom "nope"\. Available: app/);
    assert.throws(() => setState({ name: "app" }), /"value" is required/);

    assert.deepEqual(
        queryLogs().entries.map((e) => [e.kind, e.action]),
        [
            ["set_state", "set_state app @ user.name"],
            ["set_state", "set_state app"],
            ["set_state", "set_state app"],
        ],
    );
});

test("trigger_action passes JSON arguments through and reports result, diff and errors", async () => {
    const st = atom({ count: 0 });
    registerAtom("app", st);
    const received: unknown[][] = [];
    registerAction(
        "inc",
        wrapAction("inc", async (...args: unknown[]) => {
            received.push(args);
            const by = (args[0] as { by: number } | undefined)?.by ?? 1;
            st.swap((s) => ({ count: s.count + by }));
            return 0;
        }),
    );
    registerAction("fail", () => {
        st.swap((s) => ({ count: s.count + 100 }));
        throw new Error("nope");
    });

    const ok = await triggerAction({ name: "inc", args: [{ by: 5 }, "second"] });
    assert.deepEqual(received, [[{ by: 5 }, "second"]]);
    assert.equal(ok.result, 0, "falsy results are reported");
    assert.deepEqual(ok.diffs, [{ atom: "app", changes: [{ path: "count", op: "set", before: 0, after: 5 }] }]);
    assert.deepEqual(ok.logs.map((e) => e.action), ["inc"]);

    const failed = await triggerAction({ name: "fail" });
    assert.equal(failed.error, "Error: nope");
    assert.deepEqual(failed.diffs[0]!.changes, [{ path: "count", op: "set", before: 5, after: 105 }]);

    await assert.rejects(triggerAction({ name: "nope" }), /Unknown action "nope"\. Available: inc, fail/);
    await assert.rejects(triggerAction({ name: "inc", args: "x" }), /"args" must be an array/);
});

test("describe lists what is registered; unknown request types are refused", async () => {
    registerAtom("app", atom({ a: 1, b: [1, 2] }), { immutable: true });
    registerAtom("list", atom([1, 2, 3]));
    registerDerived("d", { deref: () => "x" });
    registerAction("go", () => {});
    const d = describe();
    assert.deepEqual(d.atoms, [
        { name: "app", type: "object", size: 17, keys: ["a", "b"], immutable: true },
        { name: "list", type: "array", size: 7, length: 3 },
    ]);
    assert.deepEqual(d.derived, [{ name: "d", type: "string", size: 3 }]);
    assert.deepEqual(d.actions, ["go"]);
    await assert.rejects(handleRequest("frobnicate"), /Unknown request type "frobnicate"/);
});
