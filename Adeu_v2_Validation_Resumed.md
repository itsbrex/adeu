# Adeu v2 Validation — Resumed Phases B/C/D

**Date:** 2026-04-27 (continuation of validation pass)
**Build under test:** Post-fix release of VAL-CRIT-1, VAL-CRIT-2, VAL-OBS-1.
**Test fixture:** `jcul-article-template-11-24-20.docx` (Volokh-derived law review template)

---

## TL;DR

**Critical fixes verified ✅:** All three previously reported issues (VAL-CRIT-1 footnote acceptance walker, VAL-CRIT-2 destructive normalization on accept, VAL-OBS-1 namespace inconsistency) are confirmed fixed. Acceptance is now byte-stable outside the change zone, redlines in `footnotes.xml` are properly resolved, and `w16du` is declared once at the root of each trackable part.

**New critical findings:**
- **VAL-CRIT-3** — Footnote *reference deletion* produces structurally broken output. The engine treats `[^fn-N]` in target_text as opaque characters; on a multi-paragraph delete that includes a footnote marker, the `<w:footnoteReference>` element is left orphaned in a paragraph that's about to collapse on accept.
- **VAL-CRIT-4** — Footnote *insertion* writes the literal characters `[^fn-N]` into the body as plain `<w:t>` text. No `<w:footnoteReference>` is created, no `<w:footnote>` is added to footnotes.xml. On re-read, the projection treats these literal characters as if they were a real footnote marker — a round-trip integrity failure.
- **VAL-CRIT-5** — Both Track 2 dialect tokens (`[~text~](#_Ref…)` cross-refs and `[text](url)` hyperlinks) have the same fabrication vulnerability as VAL-CRIT-4. An LLM writing these strings in `new_text` produces literal text in OOXML, which the next read parses as if it were a real construct.

**New observations:**
- **VAL-OBS-3** — Comments anchored inside `footnotes.xml` are not surfaced in the `read_docx` projection. They exist in `comments.xml` (a CriticMarkup error message revealed `[Com:9]` exists) but the projection only renders body-anchored comments.
- **VAL-OBS-4** — The appendix boundary validator is too aggressive: it rejects edits whose `target_text` happens to also appear in the appendix, even when the user's *primary anchor* is in the body. Workaround: include surrounding markdown (e.g., the leading `# `) in the target so it can only match the body.
- **VAL-OBS-5** — Bookmark anchor descriptions in the appendix become empty strings while a heading rename is in pending track-changes state. They recover correctly after acceptance.

**Validation that succeeded ✅:**
- Footnote content edits (B.1) — clean, correctly land in `footnotes.xml`.
- Acceptance traverses footnotes (B.2 / B-Recheck) — confirmed fixed.
- Silent-change detection on footnote content (B.5) — works perfectly. Footnote tampering is caught by `diff_docx_files`.
- Appendix read-only enforcement (D.1, D.2, D.3) — multiple "trick" attack vectors all rejected with clear errors.
- Appendix integrity against fake-bookmark injection (D.4) — appendix builds from real OOXML, not body text, so injecting strings that look like bookmark IDs cannot pollute it.
- Appendix updates after heading rename (D.5) — bookmark anchor descriptions correctly reflect renamed heading after acceptance.

---

## Phase A & Critical Recheck (Verified Fixed)

| Item | Result | Notes |
|---|---|---|
| TECH-1 — Live COM author warning | ✅ Verified previously | No regression |
| TECH-2 — Heading depth validation | ✅ Verified previously | No regression |
| TECH-3 — Table cell comment anchoring | ✅ Verified previously | No regression |
| TECH-6 — "rows or columns" wording | ✅ Verified previously | No regression |
| Italics strictness | ✅ Verified previously | No regression |
| **VAL-CRIT-1** — Footnote acceptance | ✅ FIXED | `accept_all_changes` now traverses `footnotes.xml` and resolves redlines cleanly |
| **VAL-CRIT-2** — Surgical mode acceptance | ✅ FIXED | Body content outside change zone is byte-equivalent to baseline; `<w:proofErr>` and pre-existing comment ranges preserved |
| **VAL-OBS-1** — w16du namespace | ✅ FIXED | `xmlns:w16du` declared at root of `document.xml`, `footnotes.xml`, and `endnotes.xml`; no more inline `xmlns:ns0` injections |

The critical recheck diff (pristine vs. footnote-edit-then-accept) shows only the expected semantic change inside `footnotes.xml` plus the namespace declarations. Document body outside the change zone is unchanged.

---

## Phase B — Track 1: Footnotes & Endnotes

### B.1 — Edit footnote content ✅ PASS

Modifying `[^fn-2]: Footnote text [...]` to `[^fn-2]: This is a substantively rewritten footnote. _See_ Bluebook rule 1.1.` produced a clean tracked change inside `footnotes.xml`:
- `<w:del>...<w:delText>old text</w:delText>...</w:del>` followed by `<w:ins>` with three properly-formatted runs (plain, italic, plain)
- Italic `_See_` correctly emitted as a discrete run with `<w:i w:val="1"/>`
- Comment range tightly scoped around the changed content
- 225 ms latency

### B.2 — Accept all changes resolves footnote redlines ✅ FIXED

Running `accept_all_changes` against B.1's output produced:
- `<w:del>` / `<w:ins>` cascade in `footnotes.xml`: gone
- Final text rendered as plain `<w:r>` runs preserving the italic formatting
- Body content untouched (byte-equivalent outside the change zone)
- 133 ms latency

### B.3 — Delete a footnote reference ❌ VAL-CRIT-3

**Test:** Replace `Normal text [ctrl-alt-0].[^fn-2]` with `Normal text [ctrl-alt-0].`, expecting the inline footnote marker AND the underlying `<w:footnote>` to be tracked-deleted atomically.

**Result:** The engine accepted the edit but produced structurally broken OOXML.

The first attempt (with `\n\nBlock quote` boundary in target) produced a particularly bad result:
- The original prose ("Normal text [ctrl-alt-0].") was wrapped in `<w:del>` ✓
- The `<w:footnoteReference>` element was **left intact**, not wrapped in `<w:del>`
- The paragraph mark of the first paragraph was marked deleted (so the paragraph collapses on accept)
- The next paragraph's heading `<w:t>Block quote</w:t>` was wrapped in `<w:del>` and the rewritten "Normal text [ctrl-alt-0]." was inserted *into* the BlockQuote-styled paragraph
- The trailing `[ctrl-alt-shift-Q].` was preserved

**On acceptance, this would produce:** the inserted "Normal text [ctrl-alt-0]." ends up styled as BlockQuote, with the orphaned `<w:footnoteReference>` floating ahead of it. The footnote in `footnotes.xml` is never deleted.

A scoped attempt (with proper paragraph-internal anchoring) similarly failed: the engine deleted *only* the textual prefix of the heading in question, and the inline `[^fn-2]` marker survived. The projection on re-read still showed `Normal text [ctrl-alt-0].[^fn-2]`.

**Diagnosis:** The engine's diff layer treats `[^fn-N]` projection tokens as opaque text characters and has no awareness that they correspond to `<w:footnoteReference>` elements requiring atomic structural deletion. When a target_text contains these tokens, the engine cannot correctly map them back to the underlying OOXML element.

**Recommendation:** This is structurally analogous to table-row insert/delete. Refuse footnote-reference deletions through text replacement with a clear error message:
> "Cannot delete footnote references via text replace. The footnote marker `[^fn-N]` corresponds to a `<w:footnoteReference>` element with associated content in `footnotes.xml`; use Word's References → Footnote management or a dedicated structural operation."

If structural footnote deletion is in scope, it needs to:
1. Wrap the `<w:footnoteReference>` in a `<w:del>` block in the body
2. Wrap the corresponding `<w:footnote w:id="N">` element's content in `<w:del>` blocks in `footnotes.xml`
3. Renumber subsequent footnote references on acceptance (or accept that w:id values are non-renumbering and dangling IDs are ignored)

### B.4 — Insert a new footnote reference ❌ VAL-CRIT-4

**Test:** Replace `Words words words.` with `Words words words.[^fn-3]`, expecting either a refusal or proper insertion of a new `<w:footnoteReference w:id="3"/>` plus a corresponding `<w:footnote w:id="3">` element in `footnotes.xml`.

**Result:** The engine accepted the edit and inserted the literal six-character string `[^fn-3]` into the body as plain text:
```xml
<w:ins ...>
  <w:r>
    <w:t>[^fn-3]</w:t>
  </w:r>
</w:ins>
```

No `<w:footnoteReference>` was created. `footnotes.xml` was not modified.

On re-read, the projection rendered this literal text as `Words words words.[^fn-3]` — exactly as if a real footnote existed. **The projection cannot distinguish a real footnote reference from literal text characters that happen to look like one.** This is a round-trip integrity failure.

**Recommendation:** Refuse `new_text` containing the dialect tokens `[^fn-N]`, `[^en-N]` (and any other reserved dialect tokens). The validator should detect these patterns and reject with:
> "Cannot insert footnote/endnote markers via text replace. Markers `[^fn-N]` and `[^en-N]` are read-only projections of OOXML footnote/endnote elements; they cannot be created by writing the syntax. Use Word's References menu to insert new footnotes."

### B.5 — Silent-change detection on footnote content ✅ PASS — DEMO-READY

**Test:** Bake a tracked change to footnote content as if it were a silent edit (apply tracked change, then accept). Compare against pristine using `diff_docx_files`.

**Result with `compare_clean=True`:**
```
@@ Word Patch @@
 ...s  [^fn-1]: * Author's note.  [^fn-2]:  
- Footnote text [ctrl-alt-F, though it should come up this automatically]
+ This citation has been silently swapped to point at a different rule
 .  Block quote in footnotes [ctrl-alt-sh...
```

The silent footnote change is surfaced cleanly. **This closes the previous coverage gap on footnote silent-change detection** — a counterparty trying to smuggle a citation modification through a footnote will not get past this check.

**Result with `compare_clean=False`:**
Same delta, presented as plain `+/-` (no `{-- --}/{++ ++}` CriticMarkup). The visual signal that distinguishes silent changes from tracked changes is preserved for footnote content.

### Bonus: VAL-OBS-3 — Footnote-anchored comments missing from projection

While running B.3, an error message revealed:
```
"... heading [ctrl-alt-3]    Normal text [ctrl-alt-0].[[^fn-2]]{>>[Com:9] Nora Devlin @ 2020-10-30T11:47:00Z: Our..."
```

A pre-existing comment `[Com:9]` is anchored to footnote 2's reference. **This comment is not visible in the `read_docx` projection** (neither in `clean_view=True` nor `clean_view=False`). The comment exists — the engine knows about it (it appears in error messages and presumably in `comments.xml`) — but the projection doesn't render it.

This is the projection-side analog of the VAL-CRIT-1 acceptance bug: an auxiliary-part walker isn't visiting all relevant locations. The projection needs to render comments anchored inside `footnotes.xml`, ideally inline next to the footnote reference or content where they're anchored, so they're visible to LLMs reviewing the document.

---

## Phase C — Track 2: Hyperlinks & Cross-References

### C.1 — Cross-reference syntax fabrication ❌ VAL-CRIT-5

**Test:** Inject `[~Section 3~](#_Ref99999)` as new_text, expecting a refusal.

**Result:** Accepted as literal text. OOXML output:
```xml
<w:ins ...>
  <w:r>
    <w:t>[~Section 3~](#_Ref99999)</w:t>
  </w:r>
</w:ins>
```

Same fabrication vulnerability as VAL-CRIT-4. On re-read, the dialect-aware projection will render this as if a real cross-reference exists.

### C.2 — Hyperlink syntax fabrication ❌ VAL-CRIT-5

**Test:** Inject `[click here](https://example.com/contract)` as new_text, expecting either a refusal or proper creation of a `<w:hyperlink>` with a new `Relationship` entry in `_rels/document.xml.rels`.

**Result:** Accepted as literal text. The `_rels` file was not modified. Re-read projection shows the literal characters as if a real hyperlink existed.

**Generalized recommendation for VAL-CRIT-5:** The dialect tokens `[^fn-N]`, `[^en-N]`, `[~text~](#_Ref…)`, and `[text](url)` are reserved by the projection format and must be defended against fabrication. Two options:

**Option A — Strict refusal (recommended for cross-refs and footnotes).** Validate `new_text` for any pattern matching the reserved dialect tokens and reject with a clear error explaining that these tokens project from OOXML structures that text replacement cannot create.

**Option B — Promote text to real OOXML (acceptable for hyperlinks only).** When `new_text` contains `[text](url)`, recognize it as an intent to create a hyperlink and write a real `<w:hyperlink>` with a new `Relationship` entry. This is more user-friendly but requires careful handling of relationship ID allocation, rels-file mutation, and namespace declarations. **Cross-references should never use this option** — bookmark anchors must already exist; the engine cannot fabricate `_Ref` IDs.

The current behavior — silently writing literal characters and then re-reading them as if they were real constructs — is the worst of all worlds.

### C.3, C.4, C.5 — Track 2 positive paths NOT TESTED

The JCUL template contains no genuine `<w:hyperlink>` elements and no `<w:fldSimple w:instr="REF _Ref…">` cross-references. To validate the positive path of Track 2 (silent URL retargeting on hyperlink edits, display-text edits on hyperlinks, rejection of cross-reference text edits), a fixture is needed that contains:
- At least one real `<w:hyperlink r:id="rId7">click here</w:hyperlink>` with a corresponding `Relationship` entry pointing at `https://...`
- At least one real `<w:hyperlink w:anchor="_Ref12345">Section 5</w:hyperlink>` (internal navigation link)
- At least one real `<w:fldSimple w:instr="REF _Ref12345 \r"/>` with computed display text

**A short hand-built fixture (1–2 pages) covering all three would be sufficient.** This was previously requested.

---

## Phase D — Track 3: Structural Appendix

### D.1 — Edit appendix content directly ✅ PASS

Target: `- _Toc57121637 → Anchored to: "Introduction [ctrl-alt-1]"` (the first appendix entry).

Result: `BatchValidationError: Modification targets the read-only boundary (Structural Appendix). This section cannot be edited.` Clean rejection in 195 ms.

### D.2 — Delete the boundary marker ✅ PASS

Target: `<!-- READONLY_BOUNDARY_START -->` itself.

Result: Same clean rejection. The boundary cannot be deleted.

### D.3 — Cross-boundary span attack ✅ PASS

Target spans body content + boundary marker: `Block quote in footnotes [...]\n\n---\n## Endnotes\n\n---\n\n<!-- READONLY_BOUNDARY_START -->`.

Result: Rejected. The validator correctly catches spans that cross the boundary, not just spans entirely inside the appendix.

### D.4 — Fake-bookmark injection in body ✅ PASS

**Test:** Inject `See _Toc99999 for fake reference.` as body text, then re-read to see if the fake `_Toc99999` shows up in the appendix.

**Result:** Body text contains the literal "See _Toc99999..." string but the appendix still lists exactly the real bookmark IDs from `document.xml`. **The appendix builds from real OOXML structure, not body text.** This is the right architectural decision: text-level injection cannot pollute the structural metadata.

### D.5 — Appendix updates on heading rename ✅ PASS (with VAL-OBS-5)

**Test:** Rename heading `# II. Conclusion` to `# II. Final Conclusions`. The bookmarks `_Toc57121643` and `_Toc57123248` are anchored to this heading.

**Pending state (after redline, before accept):** The appendix shows:
```
- _Toc57121643 → Anchored to: ""
- _Toc57123248 → Anchored to: ""
```
(empty strings)

**Accepted state:** The appendix correctly shows:
```
- _Toc57121643 → Anchored to: "II. Final Conclusions"
- _Toc57123248 → Anchored to: "II. Final Conclusions"
```

**VAL-OBS-5:** the empty-string projection during pending track-changes is technically correct (the bookmark `<w:bookmarkStart>` currently spans deleted content) but confusing for an LLM consuming the projection. It might cause the LLM to think the bookmark target was orphaned, when in reality it just hasn't been finalized. Worth considering: project the *latest non-deleted* anchor text, or both pre and post for pending edits.

### Bonus: VAL-OBS-4 — Boundary validator over-rejection

When trying to rename `II. Conclusion` → `II. Final Conclusions` *without* the leading `#` heading marker in the target, the engine rejected the edit because the string `"II. Conclusion"` also appears in the appendix entries (as `Anchored to: "II. Conclusion"`). The validator appears to scan the entire projection for the target string and refuse if any match falls past the boundary, rather than only refusing when the *primary* anchor of the change is past the boundary.

The workaround (including more disambiguating context like the leading `# `) succeeds because that disambiguating prefix only matches the body heading, not the appendix entry. **This is brittle UX.** A better validator would:
1. Use the change's *primary anchor location* (the actual position the engine is going to apply the edit) to determine boundary status
2. Only check the appendix-collision case if the primary anchor itself falls past the boundary

The current behavior makes editing any text that happens to also appear in the appendix unnecessarily painful.

---

## Performance Summary (this validation pass)

| Operation | Time |
|---|---|
| `read_docx` on JCUL template | rendered as widget |
| `process_document_batch` 1-edit (body or footnote) | 200–300 ms |
| `accept_all_changes` (post-fix) | 60–140 ms |
| `debug_xml_diff` | 80–195 ms |
| `diff_docx_files` (compare_clean=True) | 195 ms |
| `diff_docx_files` (compare_clean=False) | 190 ms |

Performance is consistent with prior sessions. No regressions.

---

## Aggregated Bug List

### New criticals from this pass

| ID | Severity | Summary |
|---|---|---|
| VAL-CRIT-3 | HIGH | Footnote-reference deletion produces structurally broken OOXML (paragraph collapse + orphaned `<w:footnoteReference>` + retained content in `footnotes.xml`) |
| VAL-CRIT-4 | HIGH | Footnote-reference *insertion* via `[^fn-N]` syntax in new_text writes literal characters as plain text; round-trip integrity broken |
| VAL-CRIT-5 | HIGH | Same fabrication vulnerability for Track 2 dialect tokens (`[~text~](#_Ref)` and `[text](url)`); literal characters written, no real OOXML constructs created |

### New observations from this pass

| ID | Severity | Summary |
|---|---|---|
| VAL-OBS-3 | MEDIUM | Comments anchored inside `footnotes.xml` are not surfaced in the `read_docx` projection |
| VAL-OBS-4 | LOW-MEDIUM | Appendix-boundary validator too aggressive: rejects edits whose target_text incidentally also appears in the appendix |
| VAL-OBS-5 | LOW | Bookmark anchor descriptions in the appendix render as empty strings during pending track-changes; recover after acceptance |

### Verified-fixed from prior pass

| ID | Status |
|---|---|
| VAL-CRIT-1 (footnote acceptance walker) | ✅ FIXED |
| VAL-CRIT-2 (destructive normalization on accept) | ✅ FIXED |
| VAL-OBS-1 (w16du namespace inconsistency) | ✅ FIXED |

---

## Demo Readiness Status

For the operator's three named demo workflows:

| Workflow | Status |
|---|---|
| Proposal vs. counterparty-response silent-change diff (NDAs, simple contracts) | ✅ DEMO-READY |
| **Same workflow extended to documents with footnotes** | ✅ **DEMO-READY** (B.5 confirms silent-change detection works on footnote content) |
| PADU playbook redlining (in-place body content edits) | ✅ DEMO-READY |
| Sanitization before send-back | ✅ DEMO-READY (verified in original session) |

For workflows that are **not** yet demo-ready:
- Documents where a contract redline involves *adding or removing footnotes* — VAL-CRIT-3, VAL-CRIT-4 will produce broken output
- Documents with hyperlinks where redlining might involve inserting new links — VAL-CRIT-5 will produce literal text instead of links
- Cross-reference-heavy contracts (M&A SPAs, credit agreements) — Track 2 positive path remains untested

---

## Recommended Next Actions

1. **Fix VAL-CRIT-3 and VAL-CRIT-4** by either refusing footnote-reference structural mutations (consistent with table-row precedent) or implementing them as proper structural operations. Refusal is the lower-risk path and matches the engine's existing pattern.

2. **Fix VAL-CRIT-5** with the same disposition (refusal) for both cross-references and hyperlinks — at minimum until proper structural creation is implemented for hyperlinks.

3. **Generate a Track 2 fixture** containing real `<w:hyperlink>` elements (both external and internal anchors) and at least one real `<w:fldSimple w:instr="REF ...">` cross-reference. This will let me complete the C.3/C.4/C.5 positive-path validation that's currently blocked.

4. **Address VAL-OBS-3** so that comments anchored in footnotes are visible to LLMs reviewing the document.

5. **Address VAL-OBS-4** by routing the boundary check through the change's primary anchor location rather than scanning all matches in the projection.

6. **Optionally address VAL-OBS-5** by projecting the post-acceptance anchor text (or both pre and post) for pending track-changes.

The architectural foundation of all three tracks is sound. The remaining issues are policy enforcement on the writer side (don't let LLMs fabricate dialect tokens) and projection completeness on the reader side (surface footnote-anchored comments).
