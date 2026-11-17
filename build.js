// Builds dist/: library modules with tsc, MCP server and CLI as single-file bundles.

import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });

execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
    stdio: "inherit",
});

for (const name of ["mcp-server", "cli"]) {
    const outfile = `dist/server/${name}.js`;
    await build({
        entryPoints: [`src/server/${name}.ts`],
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        outfile,
        banner: {
            js: "#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        },
    });
    chmodSync(outfile, 0o755);
}
