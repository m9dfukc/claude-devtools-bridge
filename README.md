# claude-devtools-bridge

MCP devtools bridge that lets Claude inspect and mutate live application state via WebSocket.

Works with any JavaScript framework — register your state containers and actions, and Claude gets 5 MCP tools to interact with your running app.

## How it works

```
Browser App                    Node MCP Server              Claude
┌──────────┐   WebSocket    ┌──────────────┐    stdio    ┌────────┐
│ Client   │◄──────────────►│ mcp-server   │◄───────────►│ Claude │
│          │  port 7777     │              │    MCP      │  Code  │
│ atoms    │                │ get_state    │             │        │
│ actions  │                │ set_state    │             │        │
│ logs     │                │ trigger_action             │        │
│          │                │ get_logs     │             │        │
│          │                │ clear_logs   │             │        │
└──────────┘                └──────────────┘             └────────┘
```

The **client** runs in your browser app and holds registered state containers and actions. The **MCP server** runs as a Node process, bridges WebSocket to MCP stdio, and exposes 5 tools that Claude can call.

## Install

```bash
npm install -D claude-devtools-bridge
```

## Quick start

### 1. Register state and actions in your app

```ts
import {
    initDevtools,
    registerAtom,
    registerAction,
    wrapAction,
} from "claude-devtools-bridge";

// Any object with deref() and reset() works
const appState = {
    _value: { count: 0, view: "home" },
    deref() { return this._value; },
    reset(val) { this._value = val; },
};

registerAtom("app", appState);

registerAction(
    "app.increment",
    wrapAction("app.increment", () => {
        const state = appState.deref();
        appState.reset({ ...state, count: state.count + 1 });
    }),
);

// Connect (returns a cleanup function)
const cleanup = initDevtools({ port: 7777 });
```

### 2. Add the MCP server to `.mcp.json`

```json
{
    "mcpServers": {
        "app-devtools": {
            "command": "npx",
            "args": ["tsx", "node_modules/claude-devtools-bridge/src/server/mcp-server.ts"]
        }
    }
}
```

### 3. Start your app and Claude Code

Claude now has access to 5 tools:

| Tool | Description |
|------|-------------|
| `get_state` | Snapshot all registered state containers as JSON |
| `set_state` | Set a state container's value by name |
| `trigger_action` | Invoke a registered action by name |
| `get_logs` | View recent action logs with before/after diffs |
| `clear_logs` | Reset the log buffer |

## The Watchable interface

The bridge works with any state container that implements two methods:

```ts
interface Watchable<T> {
    deref(): T;        // read current value
    reset(val: T): void; // replace value
}
```

### Framework adapters

**@thi.ng/atom** — works out of the box:
```ts
import { defAtom } from "@thi.ng/atom";
const db = defAtom({ count: 0 });
registerAtom("app", db); // IAtom has deref() + reset()
```

**Zustand:**
```ts
import { createStore } from "zustand/vanilla";
const store = createStore(() => ({ count: 0 }));
registerAtom("app", {
    deref: () => store.getState(),
    reset: (val) => store.setState(val),
});
```

**Jotai:**
```ts
import { createStore, atom } from "jotai";
const store = createStore();
const countAtom = atom({ count: 0 });
registerAtom("app", {
    deref: () => store.get(countAtom),
    reset: (val) => store.set(countAtom, val),
});
```

**Plain object:**
```ts
let state = { count: 0 };
registerAtom("app", {
    deref: () => state,
    reset: (val) => { state = val; },
});
```

## Dev-only usage

Gate devtools behind your framework's dev-mode check so it's stripped from production:

```ts
// Vite
if (import.meta.env.DEV) {
    const { initDevtools, registerAtom } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    initDevtools();
}

// Node / CJS
if (process.env.NODE_ENV === "development") {
    const { initDevtools, registerAtom } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    initDevtools();
}
```

## Action logging

Wrap actions with `wrapAction()` to capture before/after state snapshots:

```ts
registerAction(
    "cart.clear",
    wrapAction("cart.clear", () => {
        cartState.reset({ items: [] });
    }),
);
```

When Claude calls `get_logs`, it sees:

```
1. cart.clear  (14:08:42.577)
  [cart]
    before:
      { "items": [{ "id": 1, "name": "Widget" }] }
    after:
      { "items": [] }
```

## Configuration

### WebSocket port

Default: `7777`. Override via:

- **Client:** `initDevtools({ port: 8888 })`
- **Server:** `DEVTOOLS_PORT=8888` environment variable

## Claude plugin

This package is also a Claude Code plugin. Install it locally:

```bash
claude --plugin-dir ./node_modules/claude-devtools-bridge
```

This provides the MCP server and a skill with conventions for devtools-aware code.

## License

MIT
