---
name: devtools-bridge
description: "Conventions for the MCP devtools bridge — state registration, derived state, action wiring, effect tracking, and using MCP tools to inspect/mutate live app state. Use when writing code that creates state containers, defines actions/effects, or integrates with the devtools system."
---

# MCP Devtools Bridge

The devtools bridge lets Claude inspect and mutate live application state via MCP tools over WebSocket. The browser-side client connects to a Node MCP server that exposes 5 tools.

## Installation

```bash
npm install -D claude-devtools-bridge
```

## Quick Start

```ts
import {
    initDevtools,
    registerAtom,
    registerDerived,
    registerAction,
    unregisterAtom,
    unregisterAction,
    unregisterDerived,
    wrapAction,
    wrapEffect,
} from "claude-devtools-bridge";
import type { DisposeFn } from "claude-devtools-bridge";

// register* returns a DisposeFn — collect them for cleanup
const disposers: DisposeFn[] = [];

// Register any state container that has deref() + reset()
disposers.push(registerAtom("app", myStateContainer));

// Register read-only derived/computed state
disposers.push(
    registerDerived("app.itemCount", {
        deref: () => myStateContainer.deref().items.length,
    }),
);

// Register and wrap actions for MCP invocation
disposers.push(
    registerAction(
        "app.reset",
        wrapAction("app.reset", () => {
            myStateContainer.reset(initialState);
        }),
    ),
);

// Wrap external calls as observable effects
const fetchItems = wrapEffect("api.fetchItems", async (query: string) => {
    const res = await fetch(`/api/items?q=${query}`);
    return res.json();
});

// Connect the WebSocket client
const disconnect = initDevtools({ port: 5173 });

// On teardown (unmount, HMR, navigation):
disposers.forEach((d) => d());
disconnect();
```

## The Watchable Interface

Any state container that implements `deref()` and `reset()` can be registered:

```ts
interface Watchable<T> {
    deref(): T;        // read current value
    reset(val: T): void; // replace value
}
```

Works with: @thi.ng/atom, Jotai atoms, Zustand stores (with adapter), or plain objects.

### Adapter examples

**Plain object:**
```ts
let state = { count: 0 };
registerAtom("app", {
    deref: () => state,
    reset: (val) => { state = val; },
});
```

**Zustand:**
```ts
registerAtom("app", {
    deref: () => store.getState(),
    reset: (val) => store.setState(val),
});
```

---

## Derived State (Computed Views)

Register read-only computed values so Claude can inspect derived state alongside raw atoms:

```ts
import { registerDerived } from "claude-devtools-bridge";

// Only needs deref() — no reset()
registerDerived("app.totalPrice", {
    deref: () => cart.deref().items.reduce((sum, i) => sum + i.price, 0),
});
```

- Derived values appear under a `$derived` key in `get_state` output
- `set_state` rejects writes to derived keys with a clear error
- Works with `@thi.ng/atom` defView/defCursor, SolidJS createMemo, or any `{ deref(): T }`

---

## Effect Tracking

Wrap external calls (fetch, localStorage, APIs) so they appear in logs:

```ts
import { wrapEffect } from "claude-devtools-bridge";

const fetchData = wrapEffect("api.fetchData", async (url: string) => {
    const res = await fetch(url);
    return res.json();
});

const saveToStorage = wrapEffect("storage.save", (key: string, val: string) => {
    localStorage.setItem(key, val);
});
```

Effects log: name, args, result/error, and duration. They appear in `get_logs` output alongside action logs.

---

## How wrapAction and wrapEffect Work

Both are **transparent function decorators** — same signature in, same return value out, errors re-thrown unchanged. They do not modify what your function does; they observe it.

**`wrapAction(name, fn)`** — wraps `fn` with before/after state snapshots. On each call it `structuredClone`s all registered atoms, runs `fn`, snapshots again, diffs the two, and logs which atoms changed. Nested wrapped actions are captured as children in a tree.

**`wrapEffect(name, fn)`** — lighter than `wrapAction`. No state snapshots. Logs the function's args, return value (or error), and duration.

Both push entries into a bounded in-memory log buffer (capped at 1000 entries). Without `initDevtools()`, no WebSocket opens — the logs accumulate but nobody reads them.

**Overhead:** `wrapAction` runs `structuredClone` on every registered atom per call. This is negligible for most apps but not zero. `wrapEffect` is cheaper — just timing and serialization of args/result.

**Registration is separate from wrapping.** `wrapAction` does not register anything — it returns a decorated function. `registerAction` puts a function in the registry so Claude can trigger it via MCP. You can use one without the other:

```ts
// Wrapped + registered (full devtools integration)
registerAction("app.reset", wrapAction("app.reset", resetFn));

// Registered but not wrapped (Claude can trigger it, but no diff logging)
registerAction("app.reset", resetFn);

// Wrapped but not registered (logs diffs when called, but Claude can't trigger it)
const reset = wrapAction("app.reset", resetFn);
```

---

## Execution Tree Logging

Actions that trigger other actions are logged hierarchically:

```ts
const innerAction = wrapAction("inner.update", () => { /* ... */ });
const outerAction = wrapAction("outer.orchestrate", () => {
    innerAction(); // automatically captured as a child
});
```

In `get_logs` output, nested actions appear indented under their parent:

```
1. outer.orchestrate  (14:30:01.234)
  children:
      1. inner.update  (14:30:01.235)
```

---

## Registration Conventions

### Dev-only gating

Without `initDevtools()`, no WebSocket opens and Claude has no access. But `wrapAction`/`wrapEffect` still do work (snapshots, log buffer). For zero overhead in production, gate the entire import behind a dev check so the module is tree-shaken out:

```ts
if (import.meta.env.DEV) {
    const { initDevtools, registerAtom, wrapAction } = await import("claude-devtools-bridge");
    // ... register, wrap, connect
}
```

For apps with many components that each register state, centralizing the dev check in a single module that re-exports the bridge functions (or no-op passthroughs in production) avoids scattering `if (DEV)` checks across the codebase.

### Cleanup on teardown

`register*` returns a `DisposeFn` that removes the entry from the registry. Collect disposers and call them when the component or module unmounts:

```ts
const disposers: DisposeFn[] = [];

disposers.push(registerAtom("app/state", myState));
disposers.push(registerAction("app/reset", wrapAction("app/reset", resetFn)));

// on teardown:
disposers.forEach((d) => d());
disposers.length = 0;
```

For cross-scope cleanup (e.g. a supervisor cleaning up after a crashed plugin), use the manual `unregister*` functions:

```ts
unregisterAtom("plugin/state");
unregisterAction("plugin/process");
```

### Naming conventions

Use dot-notation or slash-notation names: `"module.action"` or `"module/action"` (e.g., `"fsm.next"`, `"cart/clear"`).

### Atoms are lazy, actions capture

Atom registrations point at the container, not a snapshot. `deref()` is called on each `get_state` request — the atom's data can change shape freely (loaded content, user profiles, FSM transitions) without re-registration.

Actions are closures that capture references at registration time. If a captured reference dies (stream unsubscribed, object null'd on teardown), the action breaks. Register actions in the same scope as the references they close over, and dispose them together.

### Dynamic components

In apps where components mount and unmount at runtime (SPA pages, lazy modules, plugin systems):

- **Register where the state is created.** If a page creates local state on mount, register it there.
- **Dispose where the state is destroyed.** Unmount, route change, module unload — call the disposers.
- **Namespace keys by component.** Use prefixes like `"cart/state"`, `"profile/actions"` to avoid collisions.

```ts
const mountPage = () => {
    const pageState = createPageStore();
    const disposers = [
        registerAtom("page/state", pageState),
        registerAction("page/clear", wrapAction("page/clear", () => pageState.reset({}))),
    ];
    return { teardown: () => disposers.forEach((d) => d()) };
};
```

When the user navigates away, `teardown()` removes the entries. Claude's `get_state` always reflects what's currently active.

---

## MCP Tools Reference

These tools are available when the MCP server is running:

| Tool | Purpose | When to use |
|------|---------|-------------|
| `get_state` | Snapshot all registered atoms and derived state as JSON | Inspect current app state |
| `set_state` | Set a state container's value by name | Debug specific states, override values |
| `trigger_action` | Invoke a registered action by name | Drive the app without manual interaction |
| `get_logs` | View recent action/effect logs with diffs and tree structure | Understand what changed and why |
| `clear_logs` | Reset the log buffer | Clean up before a new session |

---

## Anti-Patterns

- **Don't register non-serializable state.** Three.js scenes, WebGL contexts, DOM elements, and functions cannot be serialized. Only register containers with plain data.
- **Don't use devtools imports in production paths.** Gate all devtools code behind a dev-mode check.
- **Don't make actions depend on the registry.** Actions should work identically whether or not they are registered.
- **Re-registering the same name overwrites the previous entry.** This is intentional for HMR — the new `register*` call returns a fresh disposer, and the old disposer becomes a no-op (its key was already replaced). If you need explicit cleanup between registrations, call the old disposer first or use `unregister*`.
- **Don't try to set_state on derived values.** They are read-only computed views.
