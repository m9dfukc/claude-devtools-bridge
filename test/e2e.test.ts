// End-to-end: real MCP server process (stdio) ↔ relay ↔ browser client.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerAction, registerAtom, registerDerived, resetRegistryForTests } from "../src/client/action-registry.js";
import { connectDevtools } from "../src/client/devtools-client.js";
import { wrapAction } from "../src/client/wrap-action.js";
import { VERSION } from "../src/shared/version.js";
import { connect, mcpUrl, sleep, startRelay, type TestRelay } from "./helpers.js";

console.log = () => {};
console.warn = () => {};

const repo = resolve(import.meta.dirname, "..");
const exec = promisify(execFile);

const mcpClients: Client[] = [];
const startMcp = async (cwd: string, env: Record<string, string> = {}): Promise<Client> => {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", join(repo, "src/server/mcp-server.ts")],
        cwd: repo,
        env: { PATH: process.env["PATH"] ?? "", DEVTOOLS_ROOT: cwd, ...env },
        stderr: "ignore",
    });
    const client = new Client({ name: "e2e", version: "0" });
    await client.connect(transport);
    mcpClients.push(client);
    return client;
};

interface ToolResult {
    readonly text: string;
    readonly isError: boolean;
    readonly ms: number;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const t0 = Date.now();
    const res = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ text: string }>;
        isError?: boolean;
    };
    return { text: res.content.map((c) => c.text).join(""), isError: res.isError === true, ms: Date.now() - t0 };
};

const cli = async (cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> => {
    try {
        const { stdout, stderr } = await exec(
            process.execPath,
            ["--import", "tsx", join(repo, "src/server/cli.ts"), ...args],
            { cwd: repo, env: { PATH: process.env["PATH"] ?? "", DEVTOOLS_ROOT: cwd } },
        );
        return { stdout, stderr, code: 0 };
    } catch (err) {
        const e = err as { stdout: string; stderr: string; code: number };
        return { stdout: e.stdout, stderr: e.stderr, code: e.code };
    }
};

// --- the "app" ---

let state: { count: number; token: string; items: Array<{ id: number; done: boolean }> };
const received: unknown[][] = [];
const setupApp = (): void => {
    resetRegistryForTests();
    state = { count: 0, token: "secret", items: [{ id: 1, done: false }] };
    registerAtom(
        "app",
        {
            deref: () => state,
            reset: (v) => {
                state = v as typeof state;
            },
        },
        { immutable: true },
    );
    registerDerived("app/open", { deref: () => state.items.filter((i) => !i.done).length });
    registerAction(
        "counter.inc",
        wrapAction("counter.inc", (...args: unknown[]) => {
            received.push(args);
            const by = (args[0] as { by?: number } | undefined)?.by ?? 1;
            state = { ...state, count: state.count + by };
            return state.count;
        }),
    );
    registerAction("slow", () => new Promise((r) => setTimeout(() => r("late"), 400)));
};

let project: string;
let relay: TestRelay;
let mcp: Client;

before(async () => {
    project = mkdtempSync(join(tmpdir(), "bridge-e2e-"));
    relay = await startRelay({ discovery: true, root: project });
    mcp = await startMcp(project);
});

after(async () => {
    for (const c of mcpClients) await c.close();
    await relay.close();
});

test("the tool list is what the docs promise", async () => {
    const { tools } = await mcp.listTools();
    assert.deepEqual(
        tools.map((t) => t.name),
        ["status", "get_state", "set_state", "trigger_action", "get_logs", "clear_logs"],
    );
    const setState = tools.find((t) => t.name === "set_state")!;
    assert.deepEqual(setState.inputSchema.required, ["name"]);
    assert.ok("value" in (setState.inputSchema.properties ?? {}));
    assert.equal(mcp.getServerVersion()?.version, VERSION);
});

test("without a browser: status explains it, and a mutation fails at once without being replayed", async () => {
    setupApp();
    const status = await call(mcp, "status");
    assert.equal(status.isError, false);
    assert.match(status.text, /discovery file/);
    assert.match(status.text, /No browser tab is connected/);

    const failed = await call(mcp, "trigger_action", { name: "counter.inc" });
    assert.equal(failed.isError, true);
    assert.match(failed.text, /No browser tab is connected/);
    assert.ok(failed.ms < 1500, `answered in ${failed.ms}ms instead of running into a timeout`);

    const dispose = connectDevtools({ url: relay.url });
    await sleep(300);
    assert.equal(state.count, 0, "the failed call must not run once a tab connects");
    dispose();
    await sleep(500);
});

test("full round trip through the real MCP server", async (t) => {
    setupApp();
    const dispose = connectDevtools({ url: relay.url });
    const disposeAgain = connectDevtools({ url: relay.url }); // shares the socket
    t.after(() => {
        dispose();
        disposeAgain();
    });
    await sleep(300);
    assert.equal(relay.relay.status().tabs.length, 1, "repeated connectDevtools() calls share one connection");

    const status = await call(mcp, "status");
    assert.match(status.text, /Browser tabs \(1\)/);
    assert.match(status.text, /app — object \{count, token, items\}, ~\d+ chars, immutable/);
    assert.match(status.text, /Derived, read-only \(1\)/);
    assert.match(status.text, /counter\.inc, slow/);

    const all = await call(mcp, "get_state");
    assert.deepEqual(JSON.parse(all.text), {
        app: { count: 0, token: "secret", items: [{ id: 1, done: false }] },
        $derived: { "app/open": 1 },
    });
    assert.equal((await call(mcp, "get_state", { name: "app", path: "items[0].id" })).text, "1");
    assert.equal((await call(mcp, "get_state", { name: "app/open" })).text, "1");

    const unknown = await call(mcp, "get_state", { name: "nope" });
    assert.equal(unknown.isError, true);
    assert.match(unknown.text, /Atoms: app\. Derived: app\/open/);

    // Arguments arrive as real JSON values, not as strings.
    const inc = await call(mcp, "trigger_action", { name: "counter.inc", args: [{ by: 5 }] });
    assert.deepEqual(received.at(-1), [{ by: 5 }]);
    assert.match(inc.text, /Result:\n5/);
    assert.match(inc.text, /count: 0 → 5/);

    // Deep set keeps the rest of the container.
    const set = await call(mcp, "set_state", { name: "app", path: "items[0].done", value: true });
    assert.match(set.text, /items\[0\]\.done: false → true/);
    assert.deepEqual(state, { count: 5, token: "secret", items: [{ id: 1, done: true }] });

    // A string is stored as a string, and the type change is pointed out.
    const str = await call(mcp, "set_state", { name: "app", path: "items", value: "[]" });
    assert.match(str.text, /type changed from array to string/);
    assert.equal((state as unknown as { items: unknown }).items, "[]");

    const missing = await call(mcp, "set_state", { name: "app" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /"value" is required/);

    const logs = await call(mcp, "get_logs");
    assert.match(logs.text, /3 entries \(#1–#3; 3 in buffer\)\. Pass since: 3/);
    assert.match(logs.text, /#1 counter\.inc/);
    assert.match(logs.text, /args: \[\{"by":5\}\]/);
    assert.match(logs.text, /#2 ✎ set_state app @ items\[0\]\.done/);
    assert.match((await call(mcp, "get_logs", { since: 3 })).text, /No log entries match/);
    assert.match((await call(mcp, "get_logs", { limit: 1 })).text, /1 entry \(#3–#3/);

    assert.match((await call(mcp, "clear_logs")).text, /Logs cleared \(3 entries removed\)/);
    assert.match((await call(mcp, "get_logs")).text, /No log entries recorded/);
});

test("log output stays small when a large state changes a little", async (t) => {
    setupApp();
    let big = { items: Array.from({ length: 300 }, (_, i) => ({ id: i, title: `Item ${i}`, done: false })), n: 0 };
    registerAtom("todos", { deref: () => big, reset: (v) => (big = v as typeof big) }, { immutable: true });
    const tick = wrapAction("todos.tick", () => {
        big = { ...big, n: big.n + 1 };
    });
    for (let i = 0; i < 100; i++) tick();
    const dispose = connectDevtools({ url: relay.url });
    t.after(dispose);
    await sleep(300);

    const logs = await call(mcp, "get_logs");
    assert.ok(logs.text.length < 3000, `default get_logs output is ${logs.text.length} chars`);
    assert.match(logs.text, /n: 99 → 100/);
    const everything = await call(mcp, "get_logs", { limit: 500 });
    assert.ok(everything.text.length < 15_000, `all 100 entries are ${everything.text.length} chars`);

    const state = await call(mcp, "get_state", { max_chars: 4000 });
    assert.ok(state.text.length < 4500);
    assert.match(state.text, /Shortened — full value is \d+ chars/);
});

test("timeouts say what happened; a slow action can be given more time", async (t) => {
    setupApp();
    const dispose = connectDevtools({ url: relay.url });
    t.after(dispose);
    await sleep(300);
    const timedOut = await call(mcp, "trigger_action", { name: "slow", timeout_ms: 100 });
    assert.equal(timedOut.isError, true);
    assert.match(timedOut.text, /No answer from the browser tab within 100ms.*NOT cancelled/s);
    const ok = await call(mcp, "trigger_action", { name: "slow", timeout_ms: 3000 });
    assert.match(ok.text, /Result:\n"late"/);
});

test("several MCP servers and the CLI work side by side", async (t) => {
    setupApp();
    const dispose = connectDevtools({ url: relay.url });
    t.after(dispose);
    await sleep(300);

    const second = await startMcp(project);
    assert.equal(JSON.parse((await call(second, "get_state", { name: "app", path: "count" })).text), 0);
    assert.equal(JSON.parse((await call(mcp, "get_state", { name: "app", path: "count" })).text), 0);
    await second.close();
    await sleep(100);
    assert.equal((await call(mcp, "get_state", { name: "app", path: "count" })).isError, false, "first server survives the second one leaving");

    const status = await cli(project, "status");
    assert.equal(status.code, 0);
    assert.match(status.stdout, /Browser tabs \(1\)/);
    const action = await cli(project, "action", "counter.inc", '{"by": 2}');
    assert.match(action.stdout, /count: 0 → 2/);
    const read = await cli(project, "state", "app", "--path", "count");
    assert.equal(read.stdout.trim(), "2");
    const bad = await cli(project, "set", "app", "{count: 1}");
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /must be valid JSON/);
    assert.equal(state.count, 2, "invalid JSON never reaches the app");
});

test("a web page cannot read state by posing as MCP client", async () => {
    const peer = await connect(mcpUrl(relay.url), { headers: { Origin: "https://evil.example" } });
    assert.equal((await peer.closed).code, 4003);
    assert.equal((await call(mcp, "status")).isError, false, "the real MCP server is unaffected");
});

test("the MCP server recovers when the dev server restarts on another port", async () => {
    setupApp();
    // No tool call while the relay is down: without a discovery file the MCP
    // server falls back to localhost:5173, where an unrelated dev server may
    // well be running on the machine that executes the tests.
    const oldPort = relay.port;
    await relay.close();
    const occupier = createServer();
    await new Promise<void>((r) => occupier.once("error", () => r()).listen(oldPort, "127.0.0.1", r));
    relay = await startRelay({ discovery: true, root: project });
    occupier.close();
    assert.notEqual(relay.port, oldPort);

    const dispose = connectDevtools({ url: relay.url });
    await sleep(300);
    const up = await call(mcp, "get_state", { name: "app", path: "count" });
    assert.equal(up.text, "0");
    dispose();
});

test("a dev server that is not running is diagnosed as such", async () => {
    // A port nobody listens on, given explicitly so that nothing is guessed.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise((r) => probe.close(r));

    const other = await startMcp(project, { DEVTOOLS_PORT: String(port) });
    const status = await call(other, "status");
    assert.equal(status.isError, true);
    assert.match(status.text, new RegExp(`Cannot reach the relay at ws://localhost:${port}/devtools-bridge \\(from: DEVTOOLS_PORT\\): ECONNREFUSED`));
    assert.match(status.text, /Nothing is listening on that port/);

    const failed = await call(other, "get_state");
    assert.equal(failed.isError, true);
    assert.match(failed.text, /Cannot reach the relay/);
});

test("a server that is not a relay is diagnosed as such", async () => {
    const plain = createServer((_, res) => res.end("hello"));
    await new Promise<void>((r) => plain.listen(0, "127.0.0.1", r));
    const port = (plain.address() as { port: number }).port;
    const other = await startMcp(project, { DEVTOOLS_PORT: String(port) });
    const status = await call(other, "status");
    assert.equal(status.isError, true);
    assert.match(status.text, /not as a devtools-bridge relay/);
    plain.close();
    plain.closeAllConnections();
});

test("the committed dist bundles are built from this version", { skip: !existsSync(join(repo, "dist/server/cli.js")) }, async () => {
    const { stdout } = await exec(process.execPath, [join(repo, "dist/server/cli.js"), "--version"]);
    assert.equal(stdout.trim(), VERSION);
});
