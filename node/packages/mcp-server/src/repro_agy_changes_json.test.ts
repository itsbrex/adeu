import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

describe("QA Regression Test - process_document_batch with changes_json", () => {
  let serverProc: ChildProcess;
  let docPath: string;
  let outputDocPath: string;

  beforeAll(async () => {
    const fixturePath = resolve(
      __dirname,
      "../../../../shared/fixtures/golden.docx",
    );

    docPath = join(tmpdir(), `adeu_scratch_doc_${Date.now()}.docx`);
    outputDocPath = join(tmpdir(), `adeu_scratch_output_${Date.now()}.docx`);

    const fixtureBuf = readFileSync(fixturePath);
    writeFileSync(docPath, fixtureBuf);

    const serverPath = resolve(__dirname, "../dist/index.js");
    if (!existsSync(serverPath)) {
      throw new Error(
        "MCP server not built. Run 'npm run build' before running tests.",
      );
    }

    serverProc = spawn("node", [serverPath]);
  });

  afterAll(() => {
    if (serverProc && !serverProc.killed) serverProc.kill();
    if (existsSync(docPath)) unlinkSync(docPath);
    if (existsSync(outputDocPath)) unlinkSync(outputDocPath);
  });

  function sendRpc(method: string, params: any, id: number = 1): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("RPC Timeout")), 5000);

      const listener = (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (!line.startsWith("{")) continue;
          try {
            const res = JSON.parse(line);
            if (res.id === id) {
              clearTimeout(timeout);
              serverProc.stdout?.removeListener("data", listener);
              resolve(res);
            }
          } catch (e) {
            // Ignore incomplete chunks
          }
        }
      };

      serverProc.stdout?.on("data", listener);
      serverProc.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  it("should successfully process batch edits using changes_json and ignoring changes=[1, 2, 3]", async () => {
    const changesJsonStr = JSON.stringify([
      {
        type: "modify",
        target_text: "document",
        new_text: "modified tracked document",
      },
    ]);

    const res = await sendRpc(
      "tools/call",
      {
        name: "process_document_batch",
        arguments: {
          reasoning: "Test changes_json fallback bypass",
          original_docx_path: docPath,
          output_path: outputDocPath,
          author_name: "QA Tester",
          changes_json: changesJsonStr,
          changes: [1, 2, 3], // platform overwrite representation
        },
      },
      301,
    );

    console.log("Response:", JSON.stringify(res, null, 2));

    expect(res.error).toBeUndefined();
    expect(res.result).toBeDefined();
    expect(res.result.isError).toBeUndefined();
    expect(res.result.content[0].text).toContain("applied");
  });
});
