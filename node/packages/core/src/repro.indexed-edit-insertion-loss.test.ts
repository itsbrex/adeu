import { describe, it, expect } from "vitest";
import { createTestDocument, addParagraph } from "./test-utils.js";
import { extractTextFromBuffer } from "./ingest.js";
import { RedlineEngine } from "./engine.js";
import { generate_edits_from_text } from "./diff.js";

// Edits carrying a caller-supplied _match_start_index (the indexed fast path,
// e.g. generate_edits_from_text output fed straight into process_batch) skip
// _pre_resolve_heuristic_edit, the only place _internal_op is normally set.
// The engine used to apply such edits with op === undefined: the deletion
// sweep still ran, but no insertion branch did — a replacement silently
// degraded to a pure tracked deletion (new text lost, batch still reported
// "applied") and a pure insertion failed outright.
describe("Indexed edits (_match_start_index fast path)", () => {
  it("indexed replacement produces a tracked deletion AND insertion", async () => {
    const doc = await createTestDocument();
    addParagraph(doc, "The fee is 100 euros.");
    const engine = new RedlineEngine(doc);

    const idx = engine.mapper.full_text.indexOf("100");
    expect(idx).toBeGreaterThanOrEqual(0);

    const stats = engine.process_batch([
      {
        type: "modify",
        target_text: "100",
        new_text: "250",
        _match_start_index: idx,
      },
    ]);
    expect(stats.edits_applied).toBe(1);

    const xml = doc.element.toString();
    expect(xml).toContain("<w:del");
    expect(xml).toContain("<w:ins");

    const buf = await doc.save();
    const clean = await extractTextFromBuffer(buf, true);
    expect(clean).toContain("The fee is 250 euros.");
    expect(clean).not.toContain("100");
  });

  it("indexed pure deletion produces a tracked deletion only", async () => {
    const doc = await createTestDocument();
    addParagraph(doc, "Payment is strictly due on Friday.");
    const engine = new RedlineEngine(doc);

    const idx = engine.mapper.full_text.indexOf("strictly ");
    const stats = engine.process_batch([
      {
        type: "modify",
        target_text: "strictly ",
        new_text: "",
        _match_start_index: idx,
      },
    ]);
    expect(stats.edits_applied).toBe(1);

    const xml = doc.element.toString();
    expect(xml).toContain("<w:del");
    expect(xml).not.toContain("<w:ins");

    const buf = await doc.save();
    const clean = await extractTextFromBuffer(buf, true);
    expect(clean).toContain("Payment is due on Friday.");
  });

  it("indexed pure insertion applies mid-paragraph", async () => {
    const doc = await createTestDocument();
    addParagraph(doc, "Payment is due on Friday.");
    const engine = new RedlineEngine(doc);

    const idx = engine.mapper.full_text.indexOf("due");
    const stats = engine.process_batch([
      {
        type: "modify",
        target_text: "",
        new_text: "strictly ",
        _match_start_index: idx,
      },
    ]);
    expect(stats.edits_applied).toBe(1);

    const xml = doc.element.toString();
    expect(xml).toContain("<w:ins");
    expect(xml).not.toContain("<w:del");

    const buf = await doc.save();
    const clean = await extractTextFromBuffer(buf, true);
    expect(clean).toContain("Payment is strictly due on Friday.");
  });

  it("indexed insertion at index 0 lands BEFORE the first run", async () => {
    const doc = await createTestDocument();
    addParagraph(doc, "World peace treaty.");
    const engine = new RedlineEngine(doc);

    const stats = engine.process_batch([
      {
        type: "modify",
        target_text: "",
        new_text: "PREAMBLE: ",
        _match_start_index: 0,
      },
    ]);
    expect(stats.edits_applied).toBe(1);

    const buf = await doc.save();
    const clean = await extractTextFromBuffer(buf, true);
    expect(clean).toContain("PREAMBLE: World peace treaty.");
  });

  it("generate_edits_from_text output feeds straight into process_batch", async () => {
    const original = "Payment of 100 EUR is due within 30 days of invoice.";
    const modified = "Payment of 250 EUR is due within 14 days of receipt.";

    const doc = await createTestDocument();
    addParagraph(doc, original);
    const engine = new RedlineEngine(doc);

    const edits = generate_edits_from_text(original, modified);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((e) => e._match_start_index !== undefined)).toBe(true);

    const stats = engine.process_batch(edits);
    expect(stats.edits_applied).toBe(edits.length);
    expect(stats.edits_skipped).toBe(0);

    const buf = await doc.save();
    const clean = await extractTextFromBuffer(buf, true);
    expect(clean).toContain(modified);
    // The rejected view must still show the original wording as deletions.
    const tracked = await extractTextFromBuffer(buf, false);
    expect(tracked).toContain("100");
    expect(tracked).toContain("250");
  });
});
