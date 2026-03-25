import { build } from "esbuild";

await build({
    entryPoints: ["src/server/mcp-server.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: "dist/server/mcp-server.js",
    banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
