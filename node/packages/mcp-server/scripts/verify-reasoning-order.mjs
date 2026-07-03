// FILE: node/packages/mcp-server/scripts/verify-reasoning-order.mjs
// Boots the compiled MCP server over stdio, runs initialize + tools/list, and
// asserts that EVERY tool declares `reasoning` as (a) the first property and
// (b) a required field. Exit code 0 = all good, 1 = at least one violation.
//
// Usage: node scripts/verify-reasoning-order.mjs
// Requires: npm run build (dist/index.js must exist).

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../dist/index.js");

if (!existsSync(serverPath)) {
  console.error(
    `❌ Server not built: ${serverPath}. Run 'npm run build' first.`,
  );
  process.exit(1);
}

const proc = spawn("node", [serverPath]);
const pending = new Map();
let rpcId = 100;
let buf = "";

proc.stdout.on("data", (data) => {
  buf += data.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line.startsWith("{")) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb(msg);
      }
    } catch {
      /* ignore partial/non-JSON */
    }
  }
});

function rpc(method, params) {
  const id = ++rpcId;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`RPC timeout: ${method}`)), 15000);
    pending.set(id, (m) => {
      clearTimeout(t);
      res(m);
    });
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
}

function notify(method, params) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-reasoning", version: "0.0.0" },
  });
  notify("notifications/initialized", {});

  const list = await rpc("tools/list", {});
  const tools = list.result?.tools ?? [];

  if (tools.length === 0) {
    console.error("❌ tools/list returned no tools.");
    process.exit(1);
  }

  let failures = 0;
  for (const tool of tools) {
    const schema = tool.inputSchema ?? {};
    const props = schema.properties ?? {};
    const keys = Object.keys(props);
    const required = schema.required ?? [];

    const firstKey = keys[0];
    const isFirst = firstKey === "reasoning";
    const isRequired = required.includes("reasoning");
    const isString = props.reasoning?.type === "string";

    if (isFirst && isRequired && isString) {
      console.log(`✅ ${tool.name}: reasoning is first + required (string)`);
    } else {
      failures++;
      console.error(
        `❌ ${tool.name}: reasoning check failed ` +
          `(firstKey=${firstKey}, required=${isRequired}, string=${isString})`,
      );
    }
  }

  console.error(`\n${tools.length - failures}/${tools.length} tools passed.`);
  proc.kill();
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  console.error(`❌ ${e.message}`);
  proc.kill();
  process.exit(1);
}
