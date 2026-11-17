// Discovery file: lets the MCP server find the relay without a configured port.
//
// The relay writes <root>/node_modules/.cache/claude-devtools-bridge/relay-<pid>.json
// once the dev server is listening. The MCP server looks for these files from
// its working directory (see src/server/discover.ts).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const DISCOVERY_SUBDIR = join("node_modules", ".cache", "claude-devtools-bridge");
export const discoveryDir = (root) => join(root, DISCOVERY_SUBDIR);
export const isAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        return err.code === "EPERM";
    }
};
export const readDiscoveryDir = (dir) => {
    let names;
    try {
        names = readdirSync(dir);
    }
    catch {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!/^relay-\d+\.json$/.test(name))
            continue;
        try {
            const rec = JSON.parse(readFileSync(join(dir, name), "utf8"));
            if (typeof rec.port === "number" && typeof rec.pid === "number")
                out.push(rec);
        }
        catch {
            // unreadable or half-written — ignore
        }
    }
    return out;
};
/** Writes the record and returns a function that removes it again. Never throws. */
export const writeDiscovery = (record) => {
    const dir = discoveryDir(record.root);
    const file = join(dir, `relay-${record.pid}.json`);
    try {
        mkdirSync(dir, { recursive: true });
        // Drop leftovers of dev servers that did not shut down cleanly.
        for (const name of readdirSync(dir)) {
            const m = /^relay-(\d+)\.json$/.exec(name);
            if (m && Number(m[1]) !== record.pid && !isAlive(Number(m[1]))) {
                rmSync(join(dir, name), { force: true });
            }
        }
        writeFileSync(file, JSON.stringify(record, null, 2));
    }
    catch (err) {
        console.warn(`[Devtools Bridge] could not write discovery file (${err.message}) — set DEVTOOLS_PORT for the MCP server if it cannot find the relay.`);
        return () => { };
    }
    return () => {
        try {
            rmSync(file, { force: true });
        }
        catch {
            // best effort
        }
    };
};
