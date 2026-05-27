// FILE: node/packages/mcp-server/tsup.config.ts
import { defineConfig } from "tsup";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

function copyAssets(outDir: string) {
  if (existsSync("src/templates")) {
    cpSync("src/templates", join(outDir, "templates"), {
      recursive: true,
      force: true,
    });
  }
  if (existsSync("src/assets")) {
    cpSync("src/assets", join(outDir, "assets"), {
      recursive: true,
      force: true,
    });
  }
}

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    banner: {
      js: "#!/usr/bin/env node",
    },
    onSuccess: async () => {
      copyAssets("dist");
    },
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outExtension: () => ({ js: ".js" }),
    noExternal: [/(.*)/], // Bundle all NPM dependencies
    external: [/^node:/], // Leave Node.js native built-ins external
    outDir: "../../../desktop-extension",
    dts: false,
    sourcemap: false,
    clean: false, // Don't clean the whole dir (preserves icon and manifest)
    onSuccess: async () => {
      copyAssets("../../../desktop-extension");
    },
  },
]);
