// FILE: node/packages/core/debug-comment-bloat.mjs
// Standalone repro for the comment-duplication bug.
// Run from node/packages/core/ with: node debug-comment-bloat.mjs
// (Make sure `npm run build` has been run first so dist/ is populated.)

import { zipSync, strToU8 } from "fflate";
import { extractTextFromBuffer } from "./dist/index.js";

const NS_W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS_W14 =
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const NS_R =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// A paragraph where a SINGLE comment (id=1) wraps a range that spans MANY runs.
// In real Word docs this happens naturally around numbers/punctuation/formatting changes.
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS_W} ${NS_W14} ${NS_R}>
  <w:body>
    <w:p>
      <w:commentRangeStart w:id="1"/>
      <w:r><w:t xml:space="preserve">Party A shall pay </w:t></w:r>
      <w:r><w:t>100</w:t></w:r>
      <w:r><w:t>%</w:t></w:r>
      <w:r><w:t xml:space="preserve"> of the total</w:t></w:r>
      <w:r><w:t xml:space="preserve"> amount</w:t></w:r>
      <w:r><w:t xml:space="preserve"> on </w:t></w:r>
      <w:r><w:t>time</w:t></w:r>
      <w:r><w:t>.</w:t></w:r>
      <w:commentRangeEnd w:id="1"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>
    </w:p>
  </w:body>
</w:document>`;

const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${NS_W} ${NS_W14}>
  <w:comment w:id="1" w:author="Reviewer" w:date="2026-06-15T10:00:00Z" w:initials="R">
    <w:p w14:paraId="11111111" w14:textId="77777777">
      <w:r><w:t>Risk note: please confirm the payment percentage and timing.</w:t></w:r>
    </w:p>
  </w:comment>
</w:comments>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
</Types>`;

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`;

// Build the zip
const files = {
  "[Content_Types].xml": strToU8(contentTypesXml),
  "_rels/.rels": strToU8(rootRelsXml),
  "word/document.xml": strToU8(documentXml),
  "word/comments.xml": strToU8(commentsXml),
  "word/_rels/document.xml.rels": strToU8(docRelsXml),
};

const docxBuf = Buffer.from(zipSync(files));

// --- Run extraction ---
const markdown = await extractTextFromBuffer(docxBuf, false);

console.log("========== RAW PROJECTED MARKDOWN ==========");
console.log(markdown);
console.log("========== END ==========\n");

// --- Quantify the bloat ---
const commentNeedle = "[Com:1]";
const occurrences = (markdown.match(/\[Com:1\]/g) || []).length;
const highlightOpens = (markdown.match(/\{==/g) || []).length;
const metaBlocks = (markdown.match(/\{>>/g) || []).length;
const runCount = 8; // matches the 8 <w:r> runs above

console.log("========== BLOAT METRICS ==========");
console.log(`Number of <w:r> runs in the comment range: ${runCount}`);
console.log(`[Com:1] occurrences in output:             ${occurrences}`);
console.log(`{== highlight opens in output:             ${highlightOpens}`);
console.log(`{>> meta blocks in output:                 ${metaBlocks}`);
console.log(`Output length (chars):                     ${markdown.length}`);
console.log("");
console.log(`Expected (after fix): 1 [Com:1], 1 {==, 1 {>>`);
console.log(`Actual bloat factor:  ${occurrences}x`);
