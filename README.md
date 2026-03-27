# claude-devtools-bridge

MCP devtools bridge that lets Claude inspect and mutate live application state via WebSocket.

Works with any JavaScript framework — register your state containers and actions, and Claude gets 5 MCP tools to interact with your running app.

## How it works

```
Dev Server (Vite / Express / standalone)
┌─────────────────────────────────────────────┐
│                WebSocket Relay               │
│             /devtools-bridge                 │
│         ┌──────────┴──────────┐              │
│         ▼                     ▼              │
│   ?role=browser          ?role=mcp           │
└────────┬──────────────────────┬──────────────┘
         │                      │
    WS client              WS client
         │                      │
┌────────┴───┐          ┌───────┴──────┐    stdio    ┌────────┐
│ Browser App│          │  MCP Server  │◄───────────►│ Claude │
│            │          │              │    MCP      │  Code  │
│ atoms      │          │ get_state    │             │        │
│ derived    │          │ set_state    │             │        │
│ actions    │          │ trigger_action             │        │
│ effects    │          │ get_logs     │             │        │
│ logs       │          │ clear_logs   │             │        │
└────────────┘          └──────────────┘             └────────┘
```

Both the **browser client** and the **MCP server** connect as WebSocket clients to a relay hosted by your dev server. The relay forwards messages between them.

### Why this architecture?

When Claude Code's sandbox is enabled, MCP servers run as sandboxed subprocesses that cannot bind ports (`bind()` is blocked by Seatbelt) but can make outbound connections to `localhost`. By hosting the WebSocket relay on the dev server (which runs outside the sandbox) and having the MCP server connect as a client, the bridge works regardless of whether the sandbox is enabled or not — no special permissions needed.

## Setup

There are two parts: the **client** (runs in your browser app) and the **MCP server** (gives Claude the tools). You also need to mount the **relay** on your dev server.

### Option A: Claude Code plugin (recommended)

The plugin bundles the MCP server and a skill with devtools conventions. No `.mcp.json` needed.

**1. Enable the plugin** in `.claude/settings.json`:

```json
{
    "enabledPlugins": {
        "devtools-bridge@claude-devtools-bridge": true
    },
    "extraKnownMarketplaces": {
        "claude-devtools-bridge": {
            "source": {
                "source": "github",
                "repo": "m9dfukc/claude-devtools-bridge"
            }
        }
    }
}
```

**2. Install the client** as a dev dependency (for browser-side imports):

```bash
# npm
npm install -D claude-devtools-bridge@github:m9dfukc/claude-devtools-bridge

# pnpm / yarn berry (v2+)
pnpm add -D claude-devtools-bridge@github:m9dfukc/claude-devtools-bridge

# yarn v1 (classic) — needs explicit transitive dep due to hoisting quirk
yarn add -D claude-devtools-bridge@m9dfukc/claude-devtools-bridge @modelcontextprotocol/sdk
```

**3. Mount the relay** on your dev server:

#### Vite

```ts
// vite.config.ts
import { devtoolsBridgePlugin } from "claude-devtools-bridge/adapters/vite";

export default defineConfig({
    plugins: [
        devtoolsBridgePlugin(),
        // ... other plugins
    ],
});
```

#### Express / Koa / any Node http.Server

```ts
import { mountDevtoolsBridge } from "claude-devtools-bridge/adapters/node";

const server = app.listen(3000);
mountDevtoolsBridge(server);
```

#### Standalone (no dev server)

```ts
import { startDevtoolsBridge } from "claude-devtools-bridge/adapters/standalone";

startDevtoolsBridge(5173); // creates its own HTTP server
```

**4. Register state and actions** in your app:

```ts
import {
    initDevtools,
    registerAtom,
    registerDerived,
    registerAction,
    wrapAction,
    wrapEffect,
} from "claude-devtools-bridge";

// Any object with deref() and reset() works
const appState = {
    _value: { count: 0, items: [], view: "home" },
    deref() { return this._value; },
    reset(val) { this._value = val; },
};

registerAtom("app", appState);

// Register read-only derived/computed state
registerDerived("app.itemCount", {
    deref: () => appState.deref().items.length,
});

registerAction(
    "app.increment",
    wrapAction("app.increment", () => {
        const state = appState.deref();
        appState.reset({ ...state, count: state.count + 1 });
    }),
);

// Wrap external calls as observable effects
const fetchItems = wrapEffect("api.fetchItems", async (query: string) => {
    const res = await fetch(`/api/items?q=${query}`);
    return res.json();
});

// Connect to the relay on your dev server port
const cleanup = initDevtools({ port: 5173 });
```

**5. Start your app and Claude Code.** The plugin provides the MCP server automatically — Claude gets 5 tools plus the `devtools-bridge` skill.

### Option B: Standalone MCP server

If you don't want the plugin, add the MCP server manually. You'll get the 5 MCP tools, but Claude won't have the `devtools-bridge` skill — which teaches it registration conventions (dot-notation naming, `wrapAction`/`wrapEffect` patterns, dev-mode gating), MCP tool usage guidance, and anti-patterns (e.g. don't register non-serializable state).

**1. Install the package** as a dev dependency (same as above).

**2. Mount the relay** on your dev server (same as Option A, step 3).

**3. Add the MCP server** to your project's `.mcp.json`:

```json
{
    "mcpServers": {
        "devtools-bridge": {
            "command": "node",
            "args": ["node_modules/claude-devtools-bridge/dist/server/mcp-server.js"],
            "env": {
                "DEVTOOLS_PORT": "5173"
            }
        }
    }
}
```

**4. Register state and actions** in your app (same as Option A, step 4).

**5. Start your app and Claude Code.** Claude gets the 5 MCP tools but not the skill — you'd need to add that manually if desired.

## MCP tools

Once connected, Claude has access to:

| Tool | Description |
|------|-------------|
| `get_state` | Snapshot all registered atoms and derived state as JSON |
| `set_state` | Set a state container's value by name (rejects derived keys) |
| `trigger_action` | Invoke a registered action by name |
| `get_logs` | View recent action/effect logs with diffs and tree structure |
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
    const { initDevtools, registerAtom, registerDerived } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    registerDerived("app.computed", myDerivedView);
    initDevtools();
}

// Node / CJS
if (process.env.NODE_ENV === "development") {
    const { initDevtools, registerAtom, registerDerived } = await import("claude-devtools-bridge");
    registerAtom("app", myState);
    registerDerived("app.computed", myDerivedView);
    initDevtools();
}
```

## Derived state

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

### Execution tree

Actions that trigger other actions are logged hierarchically:

```ts
const innerAction = wrapAction("inner.update", () => { /* ... */ });
const outerAction = wrapAction("outer.orchestrate", () => {
    innerAction(); // automatically captured as a child
});
```

In `get_logs`, nested actions appear indented under their parent:

```
1. outer.orchestrate  (14:30:01.234)
  children:
      1. inner.update  (14:30:01.235)
```

## Effect tracking

Wrap external calls (fetch, localStorage, APIs) so they appear in logs:

```ts
import { wrapEffect } from "claude-devtools-bridge";

const fetchData = wrapEffect("api.fetchData", async (url: string) => {
    const res = await fetch(url);
    return res.json();
});
```

Effects log: name, args, result/error, and duration (ms). They appear in `get_logs` output with a lightning prefix alongside action logs.

## Configuration

### Dev server port

The MCP server and browser client both connect to the relay on your dev server. Default port: `5173` (Vite's default).

- **Client:** `initDevtools({ port: 3000 })` — set to your dev server port
- **Server:** `DEVTOOLS_PORT=3000` environment variable (in `.mcp.json` or shell)
- **Relay path:** `/devtools-bridge` by default (configurable via adapter options)

### Migration from v0.1.x (port 7777 architecture)

The previous architecture had the MCP server binding port 7777 as a WebSocket server. The new architecture flips the connection direction:

| Before | After |
|--------|-------|
| MCP server binds `:7777` | Dev server hosts relay on its port |
| Browser connects to `:7777` | Browser connects to dev server `/devtools-bridge?role=browser` |
| `DEVTOOLS_PORT=7777` | `DEVTOOLS_PORT=5173` (your dev server port) |
| No dev server integration needed | Mount relay via adapter (Vite plugin, etc.) |

**To migrate:**
1. Add the relay adapter to your dev server config (see Setup step 3)
2. Change `initDevtools({ port: 7777 })` to `initDevtools({ port: 5173 })` (or your dev server port)
3. Update `DEVTOOLS_PORT` in your `.mcp.json` if set

## License

MIT
