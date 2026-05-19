import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DocumentObject,
  RedlineEngine,
  extractTextFromBuffer,
  finalize_document,
  create_word_patch_diff,
} from "@adeu/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GOLDEN_FIXTURE = resolve(
  __dirname,
  "../../../../shared/fixtures/golden.docx",
);
const INITIAL_FIXTURE = resolve(
  __dirname,
  "../../../../shared/fixtures/initial.docx",
);

/**
 * Builds a clean DOCX buffer containing the given paragraphs.
 *
 * `initial.docx` is the pristine, empty fixture both Python and TS engines
 * use as a base for in-memory document construction. Loading it, wiping the
 * body, and injecting fresh paragraphs gives each test a known-clean starting
 * state with no pre-existing tracked changes, comments, or author entanglements.
 */
async function buildCleanDocx(paragraphs: string[]): Promise<Buffer> {
  const doc = await DocumentObject.load(readFileSync(INITIAL_FIXTURE));

  const body = doc.element;
  while (body.firstChild) {
    body.removeChild(body.firstChild);
  }

  const xmlDoc = body.ownerDocument!;
  for (const text of paragraphs) {
    const p = xmlDoc.createElement("w:p");
    const r = xmlDoc.createElement("w:r");
    const t = xmlDoc.createElement("w:t");
    t.textContent = text;
    if (text.trim() !== text) t.setAttribute("xml:space", "preserve");
    r.appendChild(t);
    p.appendChild(r);
    body.appendChild(p);
  }

  return doc.save();
}

/**
 * These tests verify that the @adeu/core entry points the n8n operations
 * depend on are stable and behave correctly. They intentionally do NOT spin up
 * the n8n runtime — that's a heavier integration concern reserved for the
 * eventual verified-node submission.
 */
describe("n8n-nodes-adeu: @adeu/core operation contracts", () => {
  it("Extract Markdown: returns CriticMarkup for the golden fixture", async () => {
    const buffer = readFileSync(GOLDEN_FIXTURE);
    const markdown = await extractTextFromBuffer(buffer, false);
    expect(typeof markdown).toBe("string");
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).toContain("golden");
  });

  it("Extract Markdown (clean view): strips CriticMarkup", async () => {
    const buffer = readFileSync(GOLDEN_FIXTURE);
    const markdown = await extractTextFromBuffer(buffer, true);
    expect(markdown).not.toContain("{++");
    expect(markdown).not.toContain("{--");
  });

  it("Apply Edits: produces a redlined DOCX buffer", async () => {
    const buffer = await buildCleanDocx([
      "The contract is governed by the State of New York.",
    ]);
    const doc = await DocumentObject.load(buffer);
    const engine = new RedlineEngine(doc, "n8n Test");

    const stats = engine.process_batch([
      {
        type: "modify",
        target_text: "State of New York",
        new_text: "State of Delaware",
        comment: "Standardizing governing law.",
      },
    ]);

    expect(stats.edits_applied).toBe(1);

    const outBuffer = await doc.save();
    expect(outBuffer.length).toBeGreaterThan(0);

    // Roundtrip: the new buffer must load and contain our tracked change.
    // The engine applies trim_common_context, so the shared prefix "State of "
    // is preserved untracked, and only "New York" -> "Delaware" is redlined.
    const roundtripText = await extractTextFromBuffer(outBuffer, false);
    expect(roundtripText).toContain("{--New York--}");
    expect(roundtripText).toContain("{++Delaware++}");
    expect(roundtripText).toContain("Standardizing governing law.");
  });

  it("Generate Diff: produces a Word Patch diff", async () => {
    const buffer = readFileSync(GOLDEN_FIXTURE);
    const originalText = await extractTextFromBuffer(buffer, true);
    const modifiedText = originalText.replace("golden", "platinum");

    const diff = create_word_patch_diff(
      originalText,
      modifiedText,
      "original.docx",
      "modified.docx",
    );

    expect(diff).toContain("@@ Word Patch @@");
    expect(diff).toContain("- golden");
    expect(diff).toContain("+ platinum");
  });

  it("Finalize Document: blocks when tracked changes are pending and acceptAll is false", async () => {
    const buffer = readFileSync(GOLDEN_FIXTURE);
    const doc = await DocumentObject.load(buffer);
    const result = await finalize_document(doc, {
      filename: "golden.docx",
      sanitize_mode: "full",
      accept_all: false,
    });
    expect(result.reportText).toContain("BLOCKED");
    expect(result.outBuffer).toBeUndefined();
  });

  it("Finalize Document: succeeds with acceptAll and read-only lock", async () => {
    const buffer = readFileSync(GOLDEN_FIXTURE);
    const doc = await DocumentObject.load(buffer);
    const result = await finalize_document(doc, {
      filename: "golden.docx",
      sanitize_mode: "full",
      accept_all: true,
      protection_mode: "read_only",
    });
    expect(result.reportText).toContain("CLEAN");
    expect(result.outBuffer).toBeDefined();
    expect(result.outBuffer!.length).toBeGreaterThan(0);
  });
});
