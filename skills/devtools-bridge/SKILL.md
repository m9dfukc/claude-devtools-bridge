---
name: devtools-bridge
description: "Conventions for the MCP devtools bridge — state registration, action wiring, and using MCP tools to inspect/mutate live app state. Use when writing code that creates state containers, defines actions, or integrates with the devtools system."
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
    registerAction,
    wrapAction,
} from "claude-devtools-bridge";

// Register any state container that has deref() + reset()
registerAtom("app", myStateContainer);

// Register and wrap actions for MCP invocation
registerAction(
    "app.reset",
    wrapAction("app.reset", () => {
        myStateContainer.reset(initialState);
    }),
);

// Connect the WebSocket client
const cleanup = initDevtools({ port: 7777 });
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

## Registration Conventions

### Every state container should be registered in dev mode

Gate devtools imports behind your framework's dev-mode check:

```ts
if (process.env.NODE_ENV === "development") {
    const { initDevtools, registerAtom } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    initDevtools();
}
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
| `get_state` | Snapshot all registered state containers as JSON | Inspect current app state |
| `set_state` | Set a state container's value by name | Debug specific states, override values |
| `trigger_action` | Invoke a registered action by name | Drive the app without manual interaction |
| `get_logs` | View recent action logs with before/after diffs | Understand what changed |
| `clear_logs` | Reset the log buffer | Clean up before a new session |

---

## Anti-Patterns

- **Don't register non-serializable state.** Three.js scenes, WebGL contexts, DOM elements, and functions cannot be serialized. Only register containers with plain data.
- **Don't use devtools imports in production paths.** Gate all devtools code behind a dev-mode check.
- **Don't make actions depend on the registry.** Actions should work identically whether or not they are registered.
- **Don't register the same name twice** without removing the first — the second call silently overwrites.
