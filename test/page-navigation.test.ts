// The tab URL / title known to the relay must follow in-page navigation,
// without navigation ever counting as "the user focused this tab".

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { registerAtom, resetRegistryForTests } from "../src/client/action-registry.js";
import { connectDevtools } from "../src/client/devtools-client.js";
import { BridgeClient } from "../src/server/bridge-client.js";
import * as ops from "../src/server/operations.js";
import { browserUrl, connect, mcpUrl, sleep, startRelay, type TestRelay } from "./helpers.js";

console.log = () => {};

// Minimal browser page: location, document and window events.
const page = { href: "http://localhost:5173/#/route-a", title: "Route A" };
const windowEvents = new EventTarget();
Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {
        protocol: "http:",
        hostname: "localhost",
        port: "5173",
        get href() {
            return page.href;
        },
    },
});
Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
        get title() {
            return page.title;
        },
        hasFocus: () => false,
        visibilityState: "visible",
        addEventListener: () => {},
        removeEventListener: () => {},
    },
});
Object.assign(globalThis, {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
});

const navigate = (href: string, title: string, event?: "hashchange" | "popstate"): void => {
    page.href = href;
    page.title = title;
    if (event) windowEvents.dispatchEvent(new Event(event));
};

let relay: TestRelay;
let dispose: () => boolean;
const tab = () => relay.relay.status().tabs.find((t) => t.version !== "other")!;

before(async () => {
    resetRegistryForTests();
    registerAtom("app", { deref: () => ({ n: 1 }), reset: () => {} });
    relay = await startRelay();
    dispose = connectDevtools({ url: relay.url });
    await sleep(200);
});

after(async () => {
    dispose();
    await relay.close();
});

test("hello carries the URL the page has when the socket opens", () => {
    assert.equal(tab().url, "http://localhost:5173/#/route-a");
    assert.equal(tab().title, "Route A");
});

test("hashchange and popstate update URL and title", async () => {
    navigate("http://localhost:5173/#/route-b", "Route B", "hashchange");
    await sleep(50);
    assert.equal(tab().url, "http://localhost:5173/#/route-b");
    assert.equal(tab().title, "Route B");

    navigate("http://localhost:5173/#/route-a", "Route A", "popstate");
    await sleep(50);
    assert.equal(tab().url, "http://localhost:5173/#/route-a");
});

test("a route that unmounts and remounts within the grace period reports the new URL on the same socket", async () => {
    const id = tab().id;
    dispose(); // route A unmounts
    navigate("http://localhost:5173/route-c", "Route C"); // pushState: no event
    dispose = connectDevtools({ url: relay.url }); // route C mounts
    await sleep(50);
    assert.equal(tab().url, "http://localhost:5173/route-c");
    assert.equal(tab().id, id, "no reconnect happened");
    await sleep(400);
    assert.equal(relay.relay.status().tabs.length, 1, "the pending close was cancelled");
});

test("pushState without a remount is picked up when the tab is asked — status shows it on the first call", async () => {
    navigate("http://localhost:5173/route-d", "Route D");
    await sleep(50);
    assert.equal(tab().url, "http://localhost:5173/route-c", "nothing told the relay yet");

    const client = new BridgeClient({ env: { DEVTOOLS_URL: relay.url } });
    const status = await ops.status(client);
    client.close();
    assert.match(status.text, /Route D — http:\/\/localhost:5173\/route-d/);
    assert.doesNotMatch(status.text, /route-c/);
});

test("navigation never moves a tab to the front of the focus order", async () => {
    const mcp = await connect(mcpUrl(relay.url));
    // A second tab that the user focused last.
    const focused = await connect(browserUrl(relay.url));
    focused.send({ type: "hello", protocol: 2, version: "other", url: "http://localhost:5173/focused", focused: true });
    await sleep(30);
    const before = tab().lastActiveAt;

    navigate("http://localhost:5173/#/background-redirect", "Redirected", "hashchange");
    await sleep(50);
    assert.equal(tab().url, "http://localhost:5173/#/background-redirect", "URL is updated");
    assert.equal(tab().lastActiveAt, before, "focus timestamp is untouched");
    assert.equal(tab().active, false);

    mcp.send({ id: "1", type: "describe" });
    assert.equal((await focused.next())["type"], "describe", "requests still go to the focused tab");
    focused.ws.close();
    mcp.ws.close();
});

test("an unchanged page is not announced again", async () => {
    const frames: string[] = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: Parameters<WebSocket["send"]>[0]) {
        frames.push(String(data));
        return send.call(this, data);
    };
    try {
        for (let i = 0; i < 3; i++) windowEvents.dispatchEvent(new Event("hashchange"));
        dispose();
        dispose = connectDevtools({ url: relay.url });
        await sleep(50);
        assert.deepEqual(frames, [], "same URL and title: nothing is sent");

        navigate("http://localhost:5173/#/once", "Once", "hashchange");
        windowEvents.dispatchEvent(new Event("popstate"));
        await sleep(50);
        assert.deepEqual(
            frames.map((f) => JSON.parse(f) as unknown),
            [{ type: "page", url: "http://localhost:5173/#/once", title: "Once" }],
            "one message, carrying only url and title",
        );
    } finally {
        WebSocket.prototype.send = send;
    }
});
