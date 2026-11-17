# Changelog

## 0.4.1

- The tab URL and title shown by `status` follow in-page navigation: hash and history
  changes (`hashchange`, `popstate`), a component that connects on an already open
  socket (route change within the close grace period), and — for routers that use
  `pushState` / `replaceState`, which fire no event — the next request the tab answers.
  `status` asks the tab before it lists the tabs, so the URL is current on the first call.
- New unsolicited browser message `page` (`url`, `title`). Unlike `active` it does not
  touch the focus order, so a background tab that navigates never takes over routing.
- No protocol change: a 0.4.0 relay ignores `page`, a 0.4.0 client never sends it.

## 0.4.0

The wire protocol between browser client, relay and MCP server changed (protocol v2).
Update the npm dependency of the app **and** the Claude Code plugin together; each side
detects an outdated counterpart and says which one needs the update.

### Relay

- Routes requests instead of forwarding blindly: any number of MCP-side clients
  (several Claude sessions, the CLI) and any number of browser tabs can be connected.
  Requests go to the most recently focused tab, or to the tab named in the request.
- Nothing is buffered anymore. A request that cannot be delivered is answered at once
  with an error, so a call that failed or timed out is never executed later.
- A tab that disconnects while a request is pending produces an immediate error.
- Admission checks: a web page cannot connect in the MCP role; the browser role is
  limited to local pages, pages served from the relay's own IP address and
  `allowedOrigins`; MCP clients from other machines need a `token`.
- Writes a discovery file with the port it really listens on.
- All adapters only handle upgrade requests for the relay path. The Node adapter no
  longer breaks other WebSocket servers on the same HTTP server.
- Adapters accept options (`path`, `allowedOrigins`, `token`, `discovery`, `root`).
  The Vite adapter is limited to `vite serve` and cleans up on server restarts.

### MCP server

- New tool `status`: connection diagnosis plus inventory of tabs, state containers,
  derived values and actions.
- `get_state`: `name`, `path`, `depth`, `max_chars`. Large state is shortened to a
  character budget with an explicit note.
- `set_state`: `name` + optional `path` for a deep, structure-preserving update;
  `value` is a JSON value. Invalid input is an error — it is no longer stored as a
  string. Returns the changes and warns when the type of the value changed.
- `trigger_action`: `args` (array of JSON values) replaces `payload`; arguments reach
  the action as values. Returns the result (also falsy ones), the state changes and
  the log entries the action produced. `timeout_ms` for long-running actions.
- `get_logs`: `limit` (default 20), `since`, `name`, `verbose`; path-level diffs
  instead of full before/after snapshots.
- All tools accept `tab`.
- Connects lazily and reconnects on the next call after any disconnect. No reconnect
  loops, no permanently dead instance after a second session connected.
- Distinct, actionable errors for: dev server not running, relay not mounted, no
  browser tab, outdated client or relay, refused connection, timeout.
- Finds the relay through `DEVTOOLS_URL`, `DEVTOOLS_PORT`/`DEVTOOLS_HOST`, the
  discovery file, then the default port. The plugin no longer pins `DEVTOOLS_PORT`.
- Reports its real name and version (`devtools-bridge`, was `app-devtools` 0.2.5).

### Browser client

- Connects to the host and port the page was loaded from by default (was
  `localhost:5173`); `url` and `host` options added.
- `initDevtools()` / `connectDevtools()` calls share one socket per target; several
  calls in one page no longer fight over the connection.
- `registerAtom(name, atom, { immutable: true })`: reference snapshots and identity
  checks instead of deep clones for immutably updated state.
- The log tree no longer relies on a global stack. Overlapping async actions are not
  nested into each other, and an action whose promise never settles no longer swallows
  all later entries. Unsettled async actions are reported as "in flight".
- Log entries store path-level changes, call arguments and a sequence number.
  `set_state` calls are logged.
- A disposer only removes the registration it created; after a re-registration the
  old disposer is a no-op (it used to delete the new entry).
- Serializer: shared references are no longer reported as circular; `Map`, `Set`,
  typed arrays and class instances keep their content; getters that throw and other
  hostile values cannot break a request.
- `wrapAction` / `wrapEffect` preserve `this`, accept thenables, and never let a
  logging failure reach the app.
- `window.__DEVTOOLS_BRIDGE__`: the same operations without any transport.

### New

- CLI `devtools-bridge` (`status`, `state`, `set`, `action`, `logs`, `clear-logs`).
- Test suite (`yarn test`): unit tests and end-to-end tests against the real MCP
  server over stdio.

### Packaging

- `@modelcontextprotocol/sdk` and `zod` are build-time dependencies now (server and
  CLI are bundled); installing the package only pulls in `ws`. The extra dependency
  yarn v1 needed is gone.
- One `tsconfig.json` for type checking, `tsconfig.build.json` for the library build;
  `build.js` replaces `build-server.js`. Source maps are no longer committed.

### Breaking changes

- Protocol v2 — see above.
- `trigger_action`: `payload` → `args`. Actions that called `JSON.parse` on their
  argument must be adjusted.
- `set_state`: `path` no longer names the container (use `name`); `value` is not a
  JSON-encoded string.
- `get_logs` output format and default size.
- `createRelayFromWss(wss, bufferSize)` → `createRelayFromWss(wss, options)`.
- Class instances, `Map`, `Set` and typed arrays in state are serialized with content
  instead of `"[non-serializable: …]"`.
