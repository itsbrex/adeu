// FILE: test_bug10.mjs
import { spawn } from "node:child_process";
import { resolve } from "node:path";

async function run() {
  const serverPath = resolve("../node/packages/mcp-server/dist/index.js");
  const child = spawn("node", [serverPath]);

  child.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      try {
        const response = JSON.parse(line);
        if (response.id === 1) {
          const text = response.result.content[0].text;
          console.log("\n--- Server Response ---");
          console.log(text);

          if (
            text.includes("Error executing tool read_docx: File not found:")
          ) {
            console.log("✅ PASS: Clean error message returned.");
          } else {
            console.error("❌ FAIL: Raw ENOENT leaked or unexpected message.");
          }
          child.kill();
          process.exit(0);
        }
      } catch (e) {}
    }
  });

  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "read_docx",
      arguments: {
        file_path: "C:\\Users\\Uzair\\Desktop\\NDA\\DOES_NOT_EXIST.docx",
      },
    },
  };

  child.stdin.write(JSON.stringify(req) + "\n");
}

run().catch(console.error);
