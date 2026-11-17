---
name: devtools-bridge
description: "Conventions for the MCP devtools bridge — state registration, derived state, action wiring, effect tracking, and using the MCP tools (status, get_state, set_state, trigger_action, get_logs) to inspect and drive live app state. Use when writing code that creates state containers, defines actions/effects, or integrates with the devtools system, and when the bridge does not connect."
---

# MCP Devtools Bridge

The devtools bridge lets Claude inspect and drive the live state of a running web app (dev build). A relay on the dev server connects the app in the browser with the MCP server, which exposes six tools.

## Using the tools

Start with `status`. It lists what is registered and, if something is not connected, says which link is missing and how to fix it.

| Tool | Purpose | Notes |
|------|---------|-------|
| `status` | Connected tabs, state containers (size, top-level keys), derived values, action names | Call first, and whenever another tool fails |
| `get_state` | Read state as JSON | `name` = one container or derived value; `name` + `path` (`"items[3].title"`) = a value inside it; `depth` collapses deep levels |
| `trigger_action` | Run a registered action and wait for it | `args` is an array of JSON values: `[{"id": 3}]` calls `action({id: 3})`. Returns result and state changes |
| `set_state` | Replace a container, or one value inside it with `path` | `value` is a JSON value, never a JSON-encoded string |
| `get_logs` | What recently ran and what it changed | Last 20 by default; `since: <seq>` for only newer entries; `name` filters |
| `clear_logs` | Empty the log buffer | |

Working habits:

- **Ask for what you need.** `get_state` with `name` and `path` instead of dumping everything. Large results are shortened and say so — narrow the request rather than raising `max_chars`.
- **Prefer `trigger_action` over `set_state`.** An action runs the app's own logic; `set_state` bypasses it. Use `set_state` to force a specific state for debugging.
- **`trigger_action` already returns the state changes** — no need for a `get_state` afterwards to see the effect.
- **After an error or timeout, look before retrying.** A timed-out call was not cancelled and may still finish. Check `get_logs` / `get_state`; do not blindly repeat a mutation.
- **Several tabs:** requests go to the most recently focused tab. `status` lists tab ids; pass `tab` to address another one.

### If the MCP tools are not available

The same operations exist as a CLI and as a global in the page:

```bash
npx devtools-bridge status
npx devtools-bridge state app --path 'items[0]'
npx devtools-bridge action app.increment '{"by": 5}'
npx devtools-bridge logs --limit 5
```

```js
// evaluated in the page (console or a browser tool)
__DEVTOOLS_BRIDGE__.status();
__DEVTOOLS_BRIDGE__.getState({ name: "app", path: "items[0]" });
await __DEVTOOLS_BRIDGE__.triggerAction("app.increment", { by: 5 });
```

### If the bridge does not connect

Read the `status` message — it distinguishes these cases:

| Message | Fix |
|---|---|
| `Cannot reach the relay … ECONNREFUSED` | Start the dev server. If it runs on an unusual port that is not discovered, set `DEVTOOLS_PORT` for the MCP server. |
| `… but not as a devtools-bridge relay` | Mount the relay: `devtoolsBridgePlugin()` in `vite.config`, or `mountDevtoolsBridge(server)`. Restart the dev server. |
| `No browser tab is connected` | Open the app in a browser (dev build). Check that `initDevtools()` / `connectDevtools()` runs. |
| `older protocol` / `outdated client` | npm dependency and plugin are on different versions — update the outdated side. |
| `refused the connection` | Page origin not in `allowedOrigins`, or token missing. |

Do not rewire the app's devtools setup because of a connection problem — the cause is almost always one of the above.

---

## Installation

```bash
npm install -D claude-devtools-bridge
```

Mount the relay on the dev server:

```ts
// vite.config.ts
import { devtoolsBridgePlugin } from "claude-devtools-bridge/adapters/vite";
export default defineConfig({ plugins: [devtoolsBridgePlugin()] });
```

No port configuration is needed: the browser client connects to the host the page was loaded from, and the MCP server discovers the relay.

## Quick Start

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

// register* returns a DisposeFn — collect them for cleanup
const disposers: DisposeFn[] = [];

// Any state container with deref() + reset().
// immutable: true — the value is only ever replaced, never mutated in place.
disposers.push(registerAtom("app", myStateContainer, { immutable: true }));

// Read-only derived/computed state
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

// Connect to the relay
const disconnect = initDevtools();

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
    reset: (val) => store.setState(val, true),
}, { immutable: true });
```

### `immutable: true`

Pass `{ immutable: true }` to `registerAtom` when the container's value is only ever replaced (immutable updates: @thi.ng/atom, Zustand, Redux, Jotai). Snapshots then keep references instead of deep-cloning, and diffs skip unchanged subtrees by identity — `wrapAction` costs almost nothing even with large state.

Leave it off for state that is mutated in place; with the option set, in-place mutations would not show up in diffs.

---

## Derived State (Computed Views)

Register read-only computed values so Claude can inspect derived state alongside raw atoms:

```ts
// Only needs deref() — no reset()
registerDerived("app.totalPrice", {
    deref: () => cart.deref().items.reduce((sum, i) => sum + i.price, 0),
});
```

- Read one with `get_state` and `name: "app.totalPrice"`; without arguments, derived values appear under a `$derived` key
- `set_state` rejects writes to derived keys with a clear error
- A derived view is the right tool to expose a small, stable slice of a large container

---

## How wrapAction and wrapEffect Work

Both are **transparent function decorators** — same arguments, same return value, `this` preserved, errors re-thrown unchanged. A failure inside the logging never reaches the app.

**`wrapAction(name, fn)`** — snapshots all registered containers before and after the call and logs the difference as path-level changes (`items[2].done: false → true`), together with the arguments.

**`wrapEffect(name, fn)`** — no state snapshots. Logs args, return value (or error) and duration. Use it for fetch, storage and other external calls.

Entries go into a bounded in-memory buffer (500 top-level entries).

**Registration is separate from wrapping.** `registerAction` makes a function callable via `trigger_action`; `wrapAction` makes calls show up in `get_logs`. Use either or both:

```ts
// Wrapped + registered (callable and logged)
registerAction("app.reset", wrapAction("app.reset", resetFn));

// Registered only (callable; trigger_action still reports the state changes it caused)
registerAction("app.reset", resetFn);

// Wrapped only (logged when the app calls it; Claude cannot trigger it)
const reset = wrapAction("app.reset", resetFn);
```

### Nesting and async

A wrapped call made synchronously inside another wrapped call is logged as its child:

```
#3 outer.orchestrate (14:30:01.234, 1.1ms)
  ↳ inner.update (14:30:01.234, 0.3ms)
```

Browsers have no async context, so nothing is guessed across an `await`:

- Calls in the synchronous part of an async action (before its first `await`) are its children.
- Calls after an `await` are logged at the top level, tagged `started while in flight: <async actions running then>`.
- The diff of an async action covers everything that changed until it settled.
- Async actions that have not settled are listed as *in flight* by `status` and `get_logs`.

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

For apps with many components that each register state, centralize the dev check in a single module that re-exports the bridge functions (or no-op passthroughs in production). If the project has such a module, use it — do not import the bridge directly.

### Cleanup on teardown

`register*` and `connectDevtools` return a `DisposeFn`. Collect disposers and call them when the component or module unmounts:

```ts
const disposers: DisposeFn[] = [
    registerAtom("app/state", myState, { immutable: true }),
    registerAction("app/reset", wrapAction("app/reset", resetFn)),
    connectDevtools(),
];

// on teardown:
disposers.forEach((d) => d());
disposers.length = 0;
```

`connectDevtools()` can be called once per component: calls share one socket, which closes after the last disposer ran.

Re-registering a name replaces the previous entry (intentional for HMR). The replaced entry's disposer then does nothing — it never removes the newer registration.

For cross-scope cleanup (e.g. a supervisor cleaning up after a crashed plugin), use `unregisterAtom(name)` / `unregisterAction(name)` / `unregisterDerived(name)`.

### Naming conventions

Use dot-notation or slash-notation names: `"module.action"` or `"module/action"` (e.g., `"fsm.next"`, `"cart/clear"`).

### Action arguments

`trigger_action` passes `args` as real arguments. Write actions with plain parameters and do not parse JSON inside them:

```ts
registerAction("sketch/select", (id: string) => select(id));
// trigger_action { name: "sketch/select", args: ["mosaic-3d"] }
```

Return a value from an action when Claude should get data back (e.g. a preset object) — it is included in the tool result.

### Atoms are lazy, actions capture

Atom registrations point at the container, not a snapshot. `deref()` is called on each request — the data can change shape freely without re-registration.

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
        connectDevtools(),
    ];
    return { teardown: () => disposers.forEach((d) => d()) };
};
```

`status` and `get_state` always reflect what is currently mounted.

---

## Anti-Patterns

- **Don't register scene graphs or handles.** Three.js scenes, WebGL contexts and DOM elements do not belong in registered state — register plain data. (`Map`, `Set`, `Date`, typed arrays and simple class instances are serialized readably.)
- **Don't use devtools imports in production paths.** Gate all devtools code behind a dev-mode check.
- **Don't make actions depend on the registry.** Actions should work identically whether or not they are registered.
- **Don't `JSON.parse` action arguments.** They arrive as values.
- **Don't set `immutable: true` on state that is mutated in place.**
- **Don't try to `set_state` on derived values.** They are read-only computed views.
- **Don't dump whole state to find one value.** Use `name` + `path`, or register a derived view.
