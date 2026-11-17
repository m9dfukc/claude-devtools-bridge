import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveRelayUrl } from "../src/client/devtools-client.js";
import { VERSION } from "../src/shared/version.js";

const read = (path: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as Record<string, unknown>;

test("package.json, plugin manifests and the runtime agree on the version", () => {
    assert.equal(read("package.json")["version"], VERSION);
    assert.equal(read(".claude-plugin/plugin.json")["version"], VERSION);
    const marketplace = read(".claude-plugin/marketplace.json") as { plugins: Array<{ version: string }> };
    assert.equal(marketplace.plugins[0]!.version, VERSION);
});

test("the browser client derives the relay URL from the page it runs in", () => {
    const vite = { protocol: "http:", hostname: "localhost", port: "5173" };
    assert.equal(resolveRelayUrl({}, vite), "ws://localhost:5173/devtools-bridge");
    assert.equal(resolveRelayUrl({ port: 5173 }, vite), "ws://localhost:5173/devtools-bridge");
    assert.equal(resolveRelayUrl({}, { ...vite, port: "5174" }), "ws://localhost:5174/devtools-bridge", "follows Vite's port fallback");
    assert.equal(resolveRelayUrl({ port: 7777 }, vite), "ws://localhost:7777/devtools-bridge");
    assert.equal(resolveRelayUrl({}, { protocol: "http:", hostname: "192.168.1.20", port: "5173" }), "ws://192.168.1.20:5173/devtools-bridge");
    assert.equal(resolveRelayUrl({}, { protocol: "https:", hostname: "dev.example.com", port: "" }), "wss://dev.example.com/devtools-bridge");
    assert.equal(resolveRelayUrl({ port: 7777 }, { protocol: "https:", hostname: "localhost", port: "5173" }), "ws://localhost:7777/devtools-bridge");
    assert.equal(resolveRelayUrl({ host: "192.168.1.20", port: 7777 }, vite), "ws://192.168.1.20:7777/devtools-bridge");
    assert.equal(resolveRelayUrl({ path: "/x" }, vite), "ws://localhost:5173/x");
    assert.equal(resolveRelayUrl({ url: "ws://kiosk.local:9000/bridge" }, vite), "ws://kiosk.local:9000/bridge");
    assert.equal(resolveRelayUrl({}, undefined), "ws://localhost:5173/devtools-bridge");
    assert.equal(resolveRelayUrl({}, { protocol: "file:", hostname: "", port: "" }), "ws://localhost:5173/devtools-bridge");
});
