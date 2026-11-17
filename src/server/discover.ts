// Finds the relay endpoint for the MCP server / CLI.
//
// Order: DEVTOOLS_URL → DEVTOOLS_PORT / DEVTOOLS_HOST → discovery file written
// by the relay → ws://localhost:5173/devtools-bridge.

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_PATH, DEFAULT_PORT } from "../shared/protocol.js";
import { discoveryDir, isAlive, readDiscoveryDir, type DiscoveryRecord } from "../relay/discovery.js";

export interface Endpoint {
    readonly url: string;
    /** How the URL was determined — shown in diagnostics. */
    readonly source: string;
    readonly record?: DiscoveryRecord;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage", "target", "vendor"]);
const MAX_DOWN_DEPTH = 3;
const MAX_UP_LEVELS = 8;
const MAX_DIRS = 3000;

interface Found {
    readonly record: DiscoveryRecord;
    /** Lower is closer to the start directory. */
    readonly distance: number;
}

const collect = (dir: string, distance: number, out: Found[]): void => {
    for (const record of readDiscoveryDir(discoveryDir(dir))) {
        if (isAlive(record.pid)) out.push({ record, distance });
    }
};

/** Relays announced in `start`, in its sub-projects, or in its parent directories. */
export const findRelays = (start: string): DiscoveryRecord[] => {
    const root = resolve(start);
    const found: Found[] = [];

    collect(root, 0, found);

    // Sub-projects (monorepo: apps/web, packages/x/…)
    let queue: string[] = [root];
    let visited = 0;
    for (let depth = 1; depth <= MAX_DOWN_DEPTH && queue.length > 0; depth++) {
        const next: string[] = [];
        for (const dir of queue) {
            let entries;
            try {
                entries = readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
                if (++visited > MAX_DIRS) break;
                const child = join(dir, entry.name);
                collect(child, depth, found);
                next.push(child);
            }
            if (visited > MAX_DIRS) break;
        }
        queue = visited > MAX_DIRS ? [] : next;
    }

    // Parent directories (Claude started inside a sub-folder of the project)
    let dir = root;
    for (let up = 1; up <= MAX_UP_LEVELS; up++) {
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
        collect(dir, 10 + up, found);
    }

    return found
        .sort((a, b) => a.distance - b.distance || b.record.startedAt - a.record.startedAt)
        .map((f) => f.record);
};

export const startDirectory = (env: NodeJS.ProcessEnv, cwd: string): string =>
    env["DEVTOOLS_ROOT"] || env["CLAUDE_PROJECT_DIR"] || cwd;

export const resolveEndpoint = (env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Endpoint => {
    if (env["DEVTOOLS_URL"]) {
        return { url: env["DEVTOOLS_URL"], source: "DEVTOOLS_URL" };
    }
    const path = env["DEVTOOLS_PATH"] || DEFAULT_PATH;
    if (env["DEVTOOLS_PORT"] || env["DEVTOOLS_HOST"]) {
        const host = env["DEVTOOLS_HOST"] || "localhost";
        const port = env["DEVTOOLS_PORT"] || String(DEFAULT_PORT);
        return {
            url: `ws://${host}:${port}${path}`,
            source: [env["DEVTOOLS_HOST"] ? "DEVTOOLS_HOST" : "", env["DEVTOOLS_PORT"] ? "DEVTOOLS_PORT" : ""]
                .filter(Boolean)
                .join(" + "),
        };
    }
    const start = startDirectory(env, cwd);
    const [record] = findRelays(start);
    if (record) {
        return {
            url: `${record.secure ? "wss" : "ws"}://localhost:${record.port}${record.path}`,
            source: `discovery file of the dev server in ${record.root} (pid ${record.pid})`,
            record,
        };
    }
    return {
        url: `ws://localhost:${DEFAULT_PORT}${path}`,
        source: `default port — no running relay announced itself under ${start}`,
    };
};
