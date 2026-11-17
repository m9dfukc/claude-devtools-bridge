import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { discoveryDir } from "../src/relay/discovery.js";
import { createRelay } from "../src/relay/ws-relay.js";
import { findRelays, resolveEndpoint } from "../src/server/discover.js";
import { browserUrl, connect, mcpUrl, silenced, sleep, startRelay, type TestRelay } from "./helpers.js";

console.warn = () => {};

const relays: TestRelay[] = [];
const relayFor = async (options = {}): Promise<TestRelay> => {
    const r = await startRelay(options);
    relays.push(r);
    return r;
};
after(async () => {
    for (const r of relays) await r.close();
});

const hello = { type: "hello", protocol: 2, version: "test" };

test("a request without a browser fails immediately and is never replayed", async () => {
    const { url } = await relayFor();
    const mcp = await connect(mcpUrl(url));
    assert.equal((await mcp.next()).type, "relay_hello");

    const started = Date.now();
    mcp.send({ id: "1", type: "trigger_action", params: { name: "inc" } });
    const answer = await mcp.next((m) => m["id"] === "1");
    assert.equal(answer["ok"], false);
    assert.equal(answer["code"], "no_browser");
    assert.ok(Date.now() - started < 500, "answered at once, not after a timeout");

    const browser = await connect(browserUrl(url));
    browser.send(hello);
    await sleep(100);
    assert.deepEqual(browser.messages, [], "the failed request must not reach a tab that connects later");
});

test("answers go back to the MCP client that asked, even with identical request ids", async () => {
    const { url } = await relayFor();
    const browser = await connect(browserUrl(url));
    browser.send(hello);
    const a = await connect(mcpUrl(url));
    const b = await connect(mcpUrl(url));

    a.send({ id: "same", type: "get_state", params: { who: "a" } });
    b.send({ id: "same", type: "get_state", params: { who: "b" } });
    for (let i = 0; i < 2; i++) {
        const req = await browser.next((m) => m["type"] === "get_state");
        browser.send({ id: req["id"], ok: true, data: (req["params"] as { who: string }).who });
    }
    assert.equal((await a.next((m) => m["id"] === "same"))["data"], "a");
    assert.equal((await b.next((m) => m["id"] === "same"))["data"], "b");
});

test("several tabs: default is the most recently focused one, others are addressable", async () => {
    const { url, relay } = await relayFor();
    const mcp = await connect(mcpUrl(url));
    const first = await connect(browserUrl(url));
    first.send({ ...hello, url: "http://localhost/one", focused: true });
    await sleep(20);
    const second = await connect(browserUrl(url));
    second.send({ ...hello, url: "http://localhost/two", focused: false });
    await sleep(20);

    mcp.send({ id: "s", type: "relay_status" });
    const status = (await mcp.next((m) => m["id"] === "s"))["data"] as { tabs: Array<{ id: string; url: string; active: boolean }> };
    assert.deepEqual(
        status.tabs.map((t) => [t.url, t.active]),
        [
            ["http://localhost/one", true],
            ["http://localhost/two", false],
        ],
    );
    assert.equal(relay.status().mcpClients, 1);

    mcp.send({ id: "1", type: "describe" });
    assert.equal((await first.next())["type"], "describe");

    second.send({ type: "active" });
    await sleep(20);
    mcp.send({ id: "2", type: "describe" });
    assert.equal((await second.next())["type"], "describe");

    const firstId = status.tabs[0]!.id;
    mcp.send({ id: "3", type: "get_logs", target: firstId });
    const req = await first.next((m) => m["type"] === "get_logs");
    first.send({ id: req["id"], ok: true, data: 1 });
    assert.equal((await mcp.next((m) => m["id"] === "3"))["tab"], firstId);

    // A `page` message updates what is shown but not who is in front.
    first.send({ type: "page", url: "http://localhost/one#moved", title: "Moved" });
    await sleep(20);
    mcp.send({ id: "p", type: "relay_status" });
    const afterPage = (await mcp.next((m) => m["id"] === "p"))["data"] as typeof status;
    assert.deepEqual(
        afterPage.tabs.map((t) => [t.url, t.active]),
        [
            ["http://localhost/one#moved", false],
            ["http://localhost/two", true],
        ],
    );

    // A tab that reloads while the browser is in the background keeps its place.
    second.ws.close();
    await sleep(20);
    const reloaded = await connect(browserUrl(url));
    reloaded.send({ ...hello, url: "http://localhost/two", focused: false, activeAt: Date.now() });
    await sleep(20);
    mcp.send({ id: "5", type: "describe" });
    assert.equal((await reloaded.next())["type"], "describe");

    mcp.send({ id: "4", type: "describe", target: "t999" });
    const unknown = await mcp.next((m) => m["id"] === "4");
    assert.equal(unknown["code"], "unknown_tab");
});

test("a tab that disconnects mid-request produces an immediate error", async () => {
    const { url } = await relayFor();
    const mcp = await connect(mcpUrl(url));
    const browser = await connect(browserUrl(url));
    browser.send(hello);
    mcp.send({ id: "1", type: "trigger_action" });
    await browser.next();
    browser.ws.close();
    const answer = await mcp.next((m) => m["id"] === "1");
    assert.equal(answer["code"], "browser_disconnected");
});

test("malformed messages are ignored instead of crashing the relay", async () => {
    const { url } = await relayFor();
    const mcp = await connect(mcpUrl(url));
    const browser = await connect(browserUrl(url));
    mcp.ws.send("not json");
    browser.ws.send("{broken");
    mcp.send({ id: "ok", type: "relay_status" });
    assert.equal((await mcp.next((m) => m["id"] === "ok"))["ok"], true);
});

test("admission: web pages cannot take the MCP role, foreign origins cannot connect as browser", async () => {
    const { url, port } = await relayFor({ allowedOrigins: ["https://dev.example.com"] });
    const closeOf = async (target: string, headers: Record<string, string> = {}) =>
        silenced(() => connect(target, { headers })).then((p) => p.closed);
    const stays = async (target: string, headers: Record<string, string> = {}) => {
        const peer = await connect(target, { headers });
        await sleep(50);
        const open = peer.ws.readyState === WebSocket.OPEN;
        peer.ws.close();
        return open;
    };

    assert.equal((await closeOf(mcpUrl(url), { Origin: "https://evil.example" })).code, 4003);
    assert.equal((await closeOf(mcpUrl(url), { Origin: "http://localhost:5173" })).code, 4003);
    assert.equal((await closeOf(browserUrl(url), { Origin: "https://evil.example" })).code, 4003);
    assert.equal((await closeOf(browserUrl(url), { Origin: "http://evil.example:5173", Host: "evil.example:5173" })).code, 4003, "DNS rebinding");

    assert.ok(await stays(browserUrl(url), { Origin: "http://localhost:5173" }));
    assert.ok(await stays(browserUrl(url), { Origin: "http://app.localhost:3000" }));
    assert.ok(await stays(browserUrl(url), { Origin: "https://dev.example.com" }));
    assert.ok(await stays(browserUrl(url), { Origin: `http://127.0.0.1:${port + 1}` }));
    assert.ok(await stays(browserUrl(url), { Origin: "http://192.168.1.20:5173", Host: "192.168.1.20:7777" }), "page served from the relay's own IP");
    assert.ok(await stays(mcpUrl(url)));

    assert.equal((await closeOf(`${url}?v=2`)).code, 4000);
    assert.equal((await closeOf(`${url}?role=browser`)).code, 4002, "v1 browser client");
    assert.equal((await closeOf(`${url}?role=mcp`)).code, 4001, "v1 MCP servers stop reconnecting on 4001");
});

test("a token is required from MCP clients once configured", async () => {
    const { url } = await relayFor({ token: "s3cret" });
    const denied = await silenced(() => connect(mcpUrl(url)));
    assert.equal((await denied.closed).code, 4003);
    const allowed = await connect(mcpUrl(url, "&token=s3cret"));
    assert.equal((await allowed.next()).type, "relay_hello");
});

test("other WebSocket servers on the same HTTP server keep working", async () => {
    const server = createServer();
    const other = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        if (req.url === "/other") other.handleUpgrade(req, socket, head, (ws) => ws.send("hi from other"));
    });
    const relay = silenced(() => createRelay(server, { discovery: false }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}/other`);
    const greeting = await new Promise((r) => ws.on("message", (m) => r(m.toString())));
    assert.equal(greeting, "hi from other");
    ws.close();

    const mcp = await connect(mcpUrl(`ws://127.0.0.1:${port}/devtools-bridge`));
    assert.equal((await mcp.next()).type, "relay_hello");

    relay.close();
    server.close();
    server.closeAllConnections();
});

test("discovery: the relay announces its real port and removes the file on close", async () => {
    const root = mkdtempSync(join(tmpdir(), "bridge-discovery-"));
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    const appRoot = join(root, "apps", "web");

    const r = await startRelay({ discovery: true, root: appRoot });
    const files = readdirSync(discoveryDir(appRoot));
    assert.deepEqual(files, [`relay-${process.pid}.json`]);

    // Found from the monorepo root, from the app itself and from a folder inside it.
    mkdirSync(join(appRoot, "src"), { recursive: true });
    for (const start of [root, appRoot, join(appRoot, "src")]) {
        const [record] = findRelays(start);
        assert.equal(record?.port, r.port, `found from ${start}`);
    }
    assert.equal(resolveEndpoint({}, root).url, `ws://localhost:${r.port}/devtools-bridge`);

    // Explicit configuration wins over discovery.
    assert.equal(resolveEndpoint({ DEVTOOLS_PORT: "3000" }, root).url, "ws://localhost:3000/devtools-bridge");
    assert.equal(resolveEndpoint({ DEVTOOLS_URL: "ws://10.0.0.2:7777/x" }, root).url, "ws://10.0.0.2:7777/x");

    await r.close();
    assert.deepEqual(readdirSync(discoveryDir(appRoot)), []);
    assert.equal(resolveEndpoint({}, root).url, "ws://localhost:5173/devtools-bridge");
});
