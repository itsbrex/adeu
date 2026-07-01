// FILE: node/packages/core/src/engine.comment-preservation.test.ts
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { DocumentObject } from "./docx/bridge.js";
import { extract_comments_data } from "./comments.js";
import { RedlineEngine } from "./engine.js";

/**
 * Regression test for author-aware comment preservation on accept/reject.
 *
 * Bug: accepting a tracked change whose run is wrapped by a comment caused
 * `_clean_wrapping_comments` to delete that comment unconditionally — even when
 * it belonged to another author. In the playbook-commenting scenario this
 * silently erased the counterparty's ("Supplier's Counsel") annotation the
 * instant their insertion (Chg:2) was accepted, destroying provenance and
 * failing the "keep the counterparty comment" requirement.
 *
 * Fix: a wrapping comment authored by someone else has its range markers
 * detached (so the accept proceeds with no orphaned anchor) but its BODY is
 * kept in the comments part. Own-authored wrapping comments are still deleted.
 *
 * The triggering document is built in-memory as a minimal valid .docx so the
 * test doesn't depend on the contents of any golden fixture: a paragraph with a
 * foreign <w:ins id="2"> whose run is wrapped by comment id="1" from that same
 * foreign author.
 */

const WORD_XMLNS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

function xmlDecl(body: string): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body;
}

/**
 * Build a minimal, valid DOCX buffer containing a wrapped foreign insertion:
 *
 *   commentRangeStart(1) → <w:ins id=2 author=insAuthor>run("INSERTED")</w:ins>
 *   → commentRangeEnd(1) → <w:r><w:commentReference id=1/></w:r>
 *
 * plus a comments part with one comment id=1 authored by commentAuthor, body
 * "robust protection". Includes [Content_Types].xml (with the comments
 * Override) and word/_rels/document.xml.rels so `load()` classifies the parts.
 */
async function buildWrappedInsertionDoc(
  insAuthor: string,
  commentAuthor: string,
): Promise<DocumentObject> {
  const contentTypes = xmlDecl(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>`,
  );

  const rootRels = xmlDecl(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const documentRels = xmlDecl(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`,
  );

  const documentXml = xmlDecl(
    `<w:document ${WORD_XMLNS}>
  <w:body>
    <w:p w14:paraId="00000001">
      <w:r><w:t xml:space="preserve">Prefix text. </w:t></w:r>
      <w:commentRangeStart w:id="1"/>
      <w:ins w:id="2" w:author="${insAuthor}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>INSERTED</w:t></w:r></w:ins>
      <w:commentRangeEnd w:id="1"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>
      <w:r><w:t xml:space="preserve"> suffix text.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`,
  );

  const commentsXml = xmlDecl(
    `<w:comments ${WORD_XMLNS}>
  <w:comment w:id="1" w:author="${commentAuthor}" w:date="2026-01-01T00:00:00Z" w:initials="SC"><w:p><w:r><w:t>robust protection</w:t></w:r></w:p></w:comment>
</w:comments>`,
  );

  const zip: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "word/document.xml": strToU8(documentXml),
    "word/comments.xml": strToU8(commentsXml),
    "word/_rels/document.xml.rels": strToU8(documentRels),
  };

  const buf = Buffer.from(zipSync(zip));
  return DocumentObject.load(buf);
}

describe("author-aware wrapping-comment preservation", () => {
  it("keeps a foreign author's wrapping comment when their change is accepted", async () => {
    const doc = await buildWrappedInsertionDoc(
      "Supplier's Counsel",
      "Supplier's Counsel",
    );

    // Sanity: comment present before we touch anything.
    const before = extract_comments_data(doc.pkg);
    expect(Object.keys(before).length).toBe(1);
    expect(before["1"].text).toContain("robust protection");

    // We ("Authority Counsel") accept the counterparty's insertion Chg:2.
    const engine = new RedlineEngine(doc, "Authority Counsel");
    engine.process_batch(
      [{ type: "accept", target_id: "Chg:2" } as any],
      false,
    );

    // The counterparty's comment body must survive the accept.
    const after = extract_comments_data(doc.pkg);
    expect(after["1"]?.text).toContain("robust protection");

    // The accept must actually have taken effect: the <w:ins> is unwrapped.
    const savedBuf = await doc.save();
    const reloaded = await DocumentObject.load(savedBuf);
    expect(reloaded.element.getElementsByTagName("w:ins").length).toBe(0);

    // Comment survives the roundtrip too.
    const afterRoundtrip = extract_comments_data(reloaded.pkg);
    expect(afterRoundtrip["1"]?.text).toContain("robust protection");
  });

  it("keeps a foreign author's wrapping comment when their change is rejected", async () => {
    const doc = await buildWrappedInsertionDoc(
      "Supplier's Counsel",
      "Supplier's Counsel",
    );

    const engine = new RedlineEngine(doc, "Authority Counsel");
    engine.process_batch(
      [{ type: "reject", target_id: "Chg:2" } as any],
      false,
    );

    // Rejecting removes the inserted TEXT, but the wrapping annotation (a
    // separate comment) is preserved rather than collaterally deleted.
    const after = extract_comments_data(doc.pkg);
    expect(after["1"]?.text).toContain("robust protection");
  });

  it("still deletes our OWN wrapping comment when we accept our own change", async () => {
    // Control: when the wrapping comment is ours, cleanup is unchanged — it is
    // removed, matching prior behavior (keeping our own now-resolved note is not
    // required).
    const doc = await buildWrappedInsertionDoc(
      "Authority Counsel",
      "Authority Counsel",
    );

    const engine = new RedlineEngine(doc, "Authority Counsel");
    engine.process_batch(
      [{ type: "accept", target_id: "Chg:2" } as any],
      false,
    );

    const after = extract_comments_data(doc.pkg);
    expect(after["1"]).toBeUndefined();
  });
});
