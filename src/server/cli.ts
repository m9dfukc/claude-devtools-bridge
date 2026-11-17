// Command-line access to the same operations as the MCP tools.
// Fallback for when the MCP server is not available in a session.

import { parseArgs } from "node:util";
import { VERSION } from "../shared/version.js";
import { BridgeClient } from "./bridge-client.js";
import * as ops from "./operations.js";

const HELP = `claude-devtools-bridge ${VERSION} — inspect and drive a running app through the devtools relay

Usage: devtools-bridge <command> [options]

Commands:
  status                              connection status, registered state and actions
  state [name]                        read state (all containers, or one)
      --path <p>  --depth <n>  --max-chars <n>
  set <name> <json>                   replace a container, or one value inside it
      --path <p>
  action <name> [json-arg ...]        invoke an action; each argument is a JSON value
      --timeout <ms>
  logs                                recent action log
      --limit <n>  --since <seq>  --name <text>  --verbose
  clear-logs                          empty the log buffer

Options (all commands):
  --tab <id>      address a specific browser tab (ids from "status")
  --url <ws-url>  relay URL (default: discovered, or DEVTOOLS_URL / DEVTOOLS_PORT)
  --port <n>      relay port on localhost
  -h, --help      show this help
  -v, --version   show the version
`;

const fail = (message: string): never => {
    process.stderr.write(`${message}\n`);
    process.exit(1);
};

const json = (text: string, what: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return fail(`${what} must be valid JSON, got: ${text}\n(Strings need quotes: '"text"')`);
    }
};

const int = (text: string | undefined, name: string): number | undefined => {
    if (text === undefined) return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : fail(`--${name} must be a number`);
};

const main = async (): Promise<void> => {
    let parsed;
    try {
        parsed = parseArgs({
            allowPositionals: true,
            options: {
                path: { type: "string" },
                depth: { type: "string" },
                "max-chars": { type: "string" },
                timeout: { type: "string" },
                limit: { type: "string" },
                since: { type: "string" },
                name: { type: "string" },
                verbose: { type: "boolean" },
                tab: { type: "string" },
                url: { type: "string" },
                port: { type: "string" },
                help: { type: "boolean", short: "h" },
                version: { type: "boolean", short: "v" },
            },
        });
    } catch (err) {
        return fail(`${(err as Error).message}\n\n${HELP}`);
    }
    const { values, positionals } = parsed;
    const [command, ...rest] = positionals;

    if (values.version) {
        process.stdout.write(`${VERSION}\n`);
        return;
    }
    if (values.help || command === undefined) {
        process.stdout.write(HELP);
        return;
    }

    const env = { ...process.env };
    if (values.url) env["DEVTOOLS_URL"] = values.url;
    if (values.port) env["DEVTOOLS_PORT"] = values.port;
    const client = new BridgeClient({ env });
    const tab = values.tab;

    let outcome: ops.Outcome;
    try {
        switch (command) {
            case "status":
                outcome = await ops.status(client, tab);
                break;
            case "state":
                outcome = await ops.getState(client, {
                    name: rest[0],
                    path: values.path,
                    depth: int(values.depth, "depth"),
                    max_chars: int(values["max-chars"], "max-chars"),
                    tab,
                });
                break;
            case "set": {
                const [name, value] = rest;
                if (name === undefined || value === undefined) return fail("Usage: devtools-bridge set <name> <json> [--path <p>]");
                outcome = await ops.setState(client, { name, value: json(value, "The value"), path: values.path, tab });
                break;
            }
            case "action": {
                const [name, ...args] = rest;
                if (name === undefined) return fail("Usage: devtools-bridge action <name> [json-arg ...]");
                outcome = await ops.triggerAction(client, {
                    name,
                    args: args.map((a, i) => json(a, `Argument ${i + 1}`)),
                    timeout_ms: int(values.timeout, "timeout"),
                    tab,
                });
                break;
            }
            case "logs":
                outcome = await ops.getLogs(client, {
                    limit: int(values.limit, "limit"),
                    since: int(values.since, "since"),
                    name: values.name,
                    verbose: values.verbose,
                    tab,
                });
                break;
            case "clear-logs":
                outcome = await ops.clearLogs(client, tab);
                break;
            default:
                return fail(`Unknown command "${command}".\n\n${HELP}`);
        }
    } catch (err) {
        client.close();
        return fail(err instanceof Error ? err.message : String(err));
    }

    client.close();
    (outcome.isError ? process.stderr : process.stdout).write(`${outcome.text}\n`);
    process.exitCode = outcome.isError ? 1 : 0;
};

void main();
