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

Effects log: name, args, result/error, and duration. They appear in `get_logs` output with an ⚡ prefix alongside action logs.

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

### Every state container should be registered in dev mode

Gate devtools imports behind your framework's dev-mode check:

```ts
if (process.env.NODE_ENV === "development") {
    const { initDevtools, registerAtom, registerDerived } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    registerDerived("app.computed", myDerivedView);
    initDevtools();
}
```

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

### Actions must be registered and wrapped

Actions that Claude should be able to trigger via MCP must be registered with `registerAction()` and wrapped with `wrapAction()` for execution logging:

```ts
registerAction(
    "module.doThing",
    wrapAction("module.doThing", () => {
        // action logic
    }),
);
```

Use dot-notation names: `"module.action"` (e.g., `"fsm.next"`, `"filter.reset"`).

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
