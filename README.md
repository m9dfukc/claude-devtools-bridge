# claude-devtools-bridge

MCP devtools bridge that lets Claude inspect and drive the live state of a running web app.

Works with any JavaScript framework — register your state containers and actions, and Claude gets six MCP tools to see what the app is doing, call its actions and read back exactly what changed.

## How it works

```
Dev Server (Vite / Express / standalone)
┌─────────────────────────────────────────────┐
│                WebSocket Relay               │
│             /devtools-bridge                 │
│         ┌──────────┴──────────┐              │
│         ▼                     ▼              │
│   browser tabs          MCP-side clients     │
└────────┬──────────────────────┬──────────────┘
         │                      │
    WS client(s)           WS client(s)
         │                      │
┌────────┴───┐          ┌───────┴──────┐    stdio    ┌────────┐
│ Browser App│          │  MCP Server  │◄───────────►│ Claude │
│            │          │  (or CLI)    │    MCP      │  Code  │
│ atoms      │          │              │             │        │
│ derived    │          │ status       │             │        │
│ actions    │          │ get_state    │             │        │
│ effects    │          │ set_state    │             │        │
│ logs       │          │ trigger_action             │        │
│            │          │ get_logs     │             │        │
│            │          │ clear_logs   │             │        │
└────────────┘          └──────────────┘             └────────┘
```

The **browser client** and the **MCP server** both connect as WebSocket clients to a relay hosted by your dev server. The relay routes each request to one browser tab and the answer back.

- **Any number of clients.** Several Claude sessions, the CLI and several browser tabs can be connected at the same time. Requests go to the most recently focused tab unless a tab is named.
- **Nothing is buffered.** If no tab can take a request, the relay answers immediately with an error. A call that failed or timed out is never executed later.
- **No port to configure.** The relay announces the port it really runs on (Vite may have picked 5174), the MCP server finds it, and the browser client connects to the host the page was loaded from.

## Setup

There are three parts: the **relay** (mounted on your dev server), the **client** (runs in your app) and the **MCP server** (gives Claude the tools). Relay and client come from the npm package; the MCP server comes from the Claude Code plugin or the same npm package.

> Keep the npm dependency and the plugin on the same version. They check each other's protocol version and tell you which side is outdated.

### 1. Install the package

```bash
npm install -D claude-devtools-bridge
pnpm add -D claude-devtools-bridge
yarn add -D claude-devtools-bridge
```

To try a commit that is not released yet, install from GitHub instead: `claude-devtools-bridge@github:m9dfukc/claude-devtools-bridge` (yarn v1: `claude-devtools-bridge@m9dfukc/claude-devtools-bridge`).

### 2. Mount the relay on your dev server

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

Other WebSocket servers on the same HTTP server (socket.io, HMR, …) are left alone — the relay only handles upgrade requests for its own path.

#### Standalone (no dev server to mount on, e.g. Next.js)

```ts
import { startDevtoolsBridge } from "claude-devtools-bridge/adapters/standalone";

startDevtoolsBridge(7777); // creates its own HTTP server
```

With a standalone relay the client needs the port: `initDevtools({ port: 7777 })`.

All three adapters take the same [relay options](#relay-options).

### 3. Register state and actions in your app

```ts
import {
    initDevtools,
    registerAtom,
    registerDerived,
    registerAction,
    wrapAction,
    wrapEffect,
} from "claude-devtools-bridge";
import type { DisposeFn } from "claude-devtools-bridge";

// Any object with deref() and reset() works
const appState = {
    _value: { count: 0, items: [], view: "home" },
    deref() { return this._value; },
    reset(val) { this._value = val; },
};

// register* returns a DisposeFn — collect them for cleanup
const disposers: DisposeFn[] = [];

// `immutable: true` — the state is only ever replaced, never mutated in place
disposers.push(registerAtom("app", appState, { immutable: true }));

// Register read-only derived/computed state
disposers.push(
    registerDerived("app.itemCount", {
        deref: () => appState.deref().items.length,
    }),
);

disposers.push(
    registerAction(
        "app.increment",
        wrapAction("app.increment", (by = 1) => {
            const state = appState.deref();
            appState.reset({ ...state, count: state.count + by });
        }),
    ),
);

// Wrap external calls as observable effects
const fetchItems = wrapEffect("api.fetchItems", async (query: string) => {
    const res = await fetch(`/api/items?q=${query}`);
    return res.json();
});

// Connects to the relay on the server the page was loaded from
const disconnect = initDevtools();

// On teardown:
// disposers.forEach((d) => d());
// disconnect();
```

`initDevtools()` / `connectDevtools()` may be called from several places (one per component, sketch, route…). Calls with the same target share one socket, which closes shortly after the last disposer ran.

### 4. Give Claude the tools

#### Option A: Claude Code plugin (recommended)

The plugin bundles the MCP server and a skill with the registration conventions. Enable it in `.claude/settings.json`:

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
            },
            "autoUpdate": true
        }
    }
}
```

#### Option B: MCP server from the npm package

Add it to your project's `.mcp.json`. You get the tools, but not the skill.

```json
{
    "mcpServers": {
        "devtools-bridge": {
            "command": "node",
            "args": ["node_modules/claude-devtools-bridge/dist/server/mcp-server.js"]
        }
    }
}
```

Start the dev server, open the app, start Claude Code. Ask Claude to call `status`.

## MCP tools

| Tool | Description |
|------|-------------|
| `status` | Connection status and inventory: connected tabs, state containers (size, top-level keys), derived values, action names. Explains what is not connected and how to fix it. |
| `get_state` | Read state as JSON — everything, one container (`name`), or a value inside it (`name` + `path`, e.g. `items[3].title`). Large results are shortened to `max_chars` (default 20000) and say so. |
| `set_state` | Replace a container, or with `path` a single value inside it. `value` is a JSON value, not a JSON-encoded string. Returns what changed. |
| `trigger_action` | Invoke an action with `args` (array of JSON values), await it, return its result and the state changes it caused. |
| `get_logs` | Recent action / effect / `set_state` log with path-level diffs. `limit` (default 20), `since` (sequence number), `name` filter, `verbose`. |
| `clear_logs` | Empty the log buffer. |

Every tool except `status` fails fast with a specific message when something is missing — no dev server, relay not mounted, no browser tab, outdated client — instead of timing out.

With several tabs open, tools take an optional `tab` id (listed by `status`).

## Without MCP: CLI and `window.__DEVTOOLS_BRIDGE__`

The same operations are available without an MCP connection — useful when the MCP server is not loaded in a session.

**CLI** (connects to the relay like the MCP server does):

```bash
npx devtools-bridge status
npx devtools-bridge state app --path 'items[0]'
npx devtools-bridge action app.increment 5
npx devtools-bridge set app 3 --path count
npx devtools-bridge logs --limit 5
```

**In the page** (console, or any tool that can evaluate JavaScript in the tab):

```js
__DEVTOOLS_BRIDGE__.status();
__DEVTOOLS_BRIDGE__.getState({ name: "app", path: "items[0]" });
await __DEVTOOLS_BRIDGE__.triggerAction("app.increment", 5);
__DEVTOOLS_BRIDGE__.setState("app", 3, "count");
__DEVTOOLS_BRIDGE__.getLogs({ limit: 5 });
```

The global is installed by `initDevtools()` / `connectDevtools()`.

## Framework adapters

The bridge works with any state container that implements `deref()` (read) and `reset(val)` (write):

**@thi.ng/atom** — works out of the box:
```ts
import { defAtom } from "@thi.ng/atom";
const db = defAtom({ count: 0 });
registerAtom("app", db, { immutable: true }); // IAtom has deref() + reset()
```

**Zustand:**
```ts
import { createStore } from "zustand/vanilla";
const store = createStore(() => ({ count: 0 }));
registerAtom("app", {
    deref: () => store.getState(),
    reset: (val) => store.setState(val, true),
}, { immutable: true });
```

**Jotai:**
```ts
import { createStore, atom } from "jotai";
const store = createStore();
const countAtom = atom({ count: 0 });
registerAtom("app", {
    deref: () => store.get(countAtom),
    reset: (val) => store.set(countAtom, val),
}, { immutable: true });
```

**Plain object:**
```ts
let state = { count: 0 };
registerAtom("app", {
    deref: () => state,
    reset: (val) => { state = val; },
});
```

### The `immutable` option

`registerAtom(name, atom, { immutable: true })` tells the bridge that the container's value is only ever *replaced*, never mutated in place — true for @thi.ng/atom, Zustand, Redux, Jotai and most modern stores.

Snapshots then keep references instead of deep-cloning the state, and unchanged subtrees are skipped by identity. `wrapAction` becomes almost free, even for large state and actions that run every frame. Without the option every wrapped call deep-clones every registered container twice.

Do not set it for state you mutate in place — changes would go unnoticed.

## Derived state

Register read-only computed values so Claude can inspect derived state alongside raw atoms:

```ts
// Only needs deref() — no reset()
registerDerived("app.totalPrice", {
    deref: () => cart.deref().items.reduce((sum, i) => sum + i.price, 0),
});
```

- `get_state` without arguments lists derived values under a `$derived` key; `get_state` with `name: "app.totalPrice"` reads one directly
- `set_state` rejects writes to derived keys with a clear error
- Works with `@thi.ng/atom` defView/defCursor, SolidJS createMemo, or any `{ deref(): T }`

A derived view is also the way to give Claude a small, stable slice of a large container.

## Action logging

Wrap actions with `wrapAction()` to log what each call changed:

```ts
registerAction(
    "cart.clear",
    wrapAction("cart.clear", () => {
        cartState.reset({ items: [] });
    }),
);
```

`get_logs` shows path-level changes, not whole snapshots:

```
#12 cart.add (14:08:42.577, 0.4ms)
  args: [{"id":7,"name":"Widget"}]
  [cart]
    + items[2]: {"id":7,"name":"Widget"}
    total: 20 → 35
```

`wrapAction` and `wrapEffect` are transparent — same arguments, same return value, `this` preserved, errors re-thrown unchanged. A failure inside the logging never reaches your app.

### Execution tree

A wrapped call made *synchronously* inside another wrapped call is logged as its child:

```ts
const inner = wrapAction("inner.update", () => { /* ... */ });
const outer = wrapAction("outer.orchestrate", () => {
    inner(); // logged as a child of outer.orchestrate
});
```

```
#3 outer.orchestrate (14:30:01.234, 1.1ms)
  ↳ inner.update (14:30:01.234, 0.3ms)
```

### Async actions

Browsers have no async context, so work that happens after an `await` cannot be attributed to its caller with certainty. The bridge does not guess:

- Calls made in the synchronous part of an async action (before its first `await`) are its children.
- Calls made later are logged at the top level and tagged with the async actions that were running at that moment (`started while in flight: …`).
- The diff of an async action covers everything that changed until it settled.
- An async action that never settles is listed as *in flight* by `status` and `get_logs` — it does not hide later entries.

## Effect tracking

Wrap external calls (fetch, localStorage, APIs) so they appear in the log with arguments, result or error, and duration:

```ts
const fetchData = wrapEffect("api.fetchData", async (url: string) => {
    const res = await fetch(url);
    return res.json();
});
```

## Teardown and unregistration

`register*` functions return a `DisposeFn` that removes the entry it created:

```ts
const disposers: DisposeFn[] = [];

disposers.push(registerAtom("app", myState));
disposers.push(registerAction("app.reset", wrapAction("app.reset", resetFn)));

// On teardown (component unmount, HMR, navigation):
disposers.forEach((d) => d());
```

Re-registering a name replaces the previous entry (intentional for HMR). The disposer of the replaced entry then does nothing and returns `false` — it never removes the newer registration, whatever order HMR runs things in.

For cross-scope cleanup (e.g. a supervisor cleaning up after a crashed plugin), use the explicit `unregister*` functions:

```ts
unregisterAtom("plugin/state");     // returns true if the entry existed
unregisterAction("plugin/process");
unregisterDerived("plugin/computed");
```

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `registerAtom` | `(name, atom, options?) => DisposeFn` | Register a state container. `options.immutable` — see above |
| `registerAction` | `(name, fn) => DisposeFn` | Register an action |
| `registerDerived` | `(name, derived) => DisposeFn` | Register derived state |
| `unregisterAtom` / `unregisterAction` / `unregisterDerived` | `(name) => boolean` | Remove by key; true if it existed |
| `wrapAction` | `(name, fn) => fn` | Log calls with state diffs |
| `wrapEffect` | `(name, fn) => fn` | Log calls with args, result, duration |
| `initDevtools` / `connectDevtools` | `(options?) => DisposeFn` | Connect to the relay; install `window.__DEVTOOLS_BRIDGE__` |

The disposer only removes the bridge's reference — it does **not** touch the underlying state container.

## Dynamic components

In apps where components mount and unmount at runtime (SPA pages, lazy-loaded modules, plugin systems), namespace keys by component (e.g. `"cart/state"`, `"profile/actions"`) and co-locate registrations with the lifecycle that owns the state:

```ts
// pages/cart.ts
const mountCart = () => {
    const cartState = createCartStore();
    const disposers = [
        registerAtom("cart/state", cartState),
        registerAction("cart/clear", wrapAction("cart/clear", () => cartState.reset({ items: [] }))),
        registerAction("cart/checkout", wrapAction("cart/checkout", checkout)),
        connectDevtools(),
    ];

    return {
        teardown: () => disposers.forEach((d) => d()),
    };
};
```

When the user navigates away, `teardown()` removes the cart entries. `status` and `get_state` always reflect what is currently mounted.

**Atoms vs actions:** Atom registrations are lazy — `deref()` reads the current value at query time. Actions are closures that capture references at registration time. Register actions in the same scope as the references they close over, and dispose them together.

## What state looks like to Claude

Values are converted to plain JSON on the way out:

| In the app | In `get_state` |
|---|---|
| Plain objects, arrays, primitives | as is |
| The same object referenced twice | serialized twice (only real cycles become `"[non-serializable: circular]"`) |
| `Date` | ISO string |
| `Map` / `Set` | `{ "$type": "Map", "entries": [[k, v], …] }` / `{ "$type": "Set", "values": […] }` |
| Typed arrays | `{ "$type": "Float32Array", "length": n, "values": [first 64] }` |
| Class instances | own enumerable properties plus `"$type": "ClassName"` |
| Functions, symbols, DOM nodes | `"[non-serializable: …]"` placeholders |

Scene graphs, WebGL contexts and similar objects still do not belong in registered state — register plain data.

## Dev-only usage

Without `initDevtools()` no WebSocket opens, but `wrapAction` / `wrapEffect` still snapshot and log. For zero overhead in production, gate the entire import behind a dev check so the module is tree-shaken out:

```ts
if (import.meta.env.DEV) {
    const { initDevtools, registerAtom, registerAction, wrapAction } =
        await import("claude-devtools-bridge");

    const disposers = [
        registerAtom("app", myState, { immutable: true }),
        registerAction("app.reset", wrapAction("app.reset", resetFn)),
    ];
    const disconnect = initDevtools();
}
```

For apps with many components that each register state, centralize the dev check in a single module that re-exports the bridge functions (or no-op passthroughs in production).

## Configuration

Usually there is nothing to configure.

### How the pieces find each other

- **Browser client → relay:** the host and port the page was loaded from. Override with `initDevtools({ port })`, `{ host, port }` or `{ url }`.
- **MCP server / CLI → relay**, first match wins:
  1. `DEVTOOLS_URL` — full WebSocket URL
  2. `DEVTOOLS_PORT` (and optionally `DEVTOOLS_HOST`, `DEVTOOLS_PATH`)
  3. The discovery file the relay writes to `node_modules/.cache/claude-devtools-bridge/` of the dev server's project. It is searched in the project directory, its sub-projects (three levels) and its parent directories.
  4. `ws://localhost:5173/devtools-bridge`

  `status` shows which one was used. The project directory is `DEVTOOLS_ROOT`, else `CLAUDE_PROJECT_DIR` (set by Claude Code), else the working directory.

Other environment variables of the MCP server: `DEVTOOLS_TIMEOUT_MS` (default request timeout, 10000) and `DEVTOOLS_TOKEN`.

### Relay options

```ts
devtoolsBridgePlugin({
    path: "/devtools-bridge",                    // WebSocket path
    allowedOrigins: ["https://dev.example.com"], // extra page origins
    token: process.env.DEVTOOLS_TOKEN,           // for MCP clients on other machines
    discovery: true,                             // write the discovery file
});
```

### Who may connect

A WebSocket server on localhost can be reached by any website you visit, so the relay checks who is asking:

- **MCP role** (reads and changes state): only non-browser clients — a web page cannot take this role — and only from the same machine, unless a `token` is configured.
- **Browser role:** pages on `localhost` / `127.0.0.1`, pages served from the same IP address the relay was reached on, and origins listed in `allowedOrigins`. Add your origin there when you develop behind a custom hostname or a tunnel.

A refused client is told why (close code 4003) and does not retry.

### Remote devices, containers

To inspect an app running on another machine (kiosk, installation, phone) or to run Claude in a container:

```ts
// dev server / relay side
devtoolsBridgePlugin({ token: "something-long" });
```

```bash
# MCP server / CLI side
DEVTOOLS_HOST=192.168.1.20 DEVTOOLS_PORT=5173 DEVTOOLS_TOKEN=something-long
```

The dev server has to listen on the network for this (`vite --host`). The browser on the device needs no configuration: it connects to the host it loaded the page from.

## Troubleshooting

Call `status` (or `npx devtools-bridge status`) — it names the failing link:

| Message | Meaning |
|---|---|
| `Cannot reach the relay … ECONNREFUSED` | Dev server not running, or on a port the MCP server does not know (set `DEVTOOLS_PORT`). |
| `A server answers … but not as a devtools-bridge relay` | Relay adapter not mounted on that dev server. |
| `No browser tab is connected` | App not open in a browser, production build, or `initDevtools()` not called. |
| `… speaks an older protocol` / `outdated client` | npm dependency and plugin are on different versions. |
| `The relay … refused the connection` | Origin not allowed, or token missing — see [Who may connect](#who-may-connect). |
| `No answer from the browser tab within …ms` | Tab paused (background throttling, breakpoint) or the action is still running. The call is not repeated. |

Things to know:

- Background tabs are throttled by the browser. Actions that depend on `requestAnimationFrame` do not progress in a hidden tab.
- If Claude starts the dev server itself inside Claude Code's Bash sandbox, binding a port can be blocked — allow local binding in the sandbox settings or start the dev server yourself.
- A cloud or remote Claude session cannot reach `localhost` of your machine.

## Development

```bash
yarn install
yarn typecheck
yarn test    # unit tests + end-to-end tests against the real MCP server
yarn build   # rebuilds dist/ (committed — the plugin and GitHub installs use it)
```

## Migration

See [CHANGELOG.md](CHANGELOG.md) for details.

**From a GitHub install:** `yarn remove claude-devtools-bridge && yarn add -D claude-devtools-bridge`.

**From v0.3.x to v0.4.0** — the wire protocol changed; update the npm dependency *and* the plugin together.

- `trigger_action`: `payload` (JSON string, passed to the action unparsed) is replaced by `args` (array of JSON values, passed as real arguments). Actions that called `JSON.parse` on their argument must stop doing so.
- `set_state`: the container is now `name`; `path` addresses a value inside it. `value` is a JSON value; an invalid value is an error instead of being stored as a string.
- `get_state` takes `name` / `path` / `depth` / `max_chars`; large state is shortened.
- `get_logs` returns the last 20 entries by default and shows path-level diffs.
- New tool `status`.
- `initDevtools()` without arguments connects to the host the page was loaded from (was: `localhost:5173`).
- The plugin no longer pins `DEVTOOLS_PORT`; the port is discovered.
- `createRelayFromWss(wss, bufferSize)` → `createRelayFromWss(wss, options)`. There is no buffer anymore.
- Class instances, `Map`, `Set` and typed arrays in state are serialized with content instead of a placeholder.

**From v0.2.x:** `register*` functions return a `DisposeFn`.

**From v0.1.x:** The MCP server no longer binds its own port; the relay runs on your dev server.

## License

MIT
