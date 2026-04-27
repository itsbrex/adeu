# Adeu v2 Validation Report — Session Findings

**Date:** 2026-04-27 (validation pass against post-renewal build)
**Build:** Post-syntax-renewal release with TECH-1, TECH-2, TECH-3, TECH-6, italics-strictness, and Tracks 1/2/3 dialect work.
**Test fixture:** `jcul-article-template-11-24-20.docx` (Volokh-derived law-review template — exercises footnotes, multi-level numbering, TOC bookmarks).

---

## TL;DR for the team

**Phase A — Tech debt fixes: ✅ ALL VERIFIED CLEAN.** All four tech-debt items (TECH-1, TECH-2, TECH-3, TECH-6) plus the italics strictness change pass cleanly. Wording quality is excellent and behaviors are tighter than originally requested.

**Phase B — Track 1 (Footnotes/Endnotes) verification surfaced TWO CRITICAL BUGS:**

- **VAL-CRIT-1** — `accept_all_changes` does NOT process tracked changes inside `footnotes.xml`. Body redlines are accepted correctly; footnote redlines are silently skipped, leaving `<w:del>` and `<w:ins>` markup intact in the "accepted" output. **Severity: HIGH.** This breaks the entire round-trip workflow for documents with footnotes — counterparties will see redlines that should have been resolved.

- **VAL-CRIT-2** — `accept_all_changes` performs aggressive document rewrites in regions that had NO tracked changes. It strips pre-existing comment range markers (`<w:commentRangeStart>` / `<w:commentRangeEnd>`) while leaving the `<w:comment>` and `<w:commentReference>` survivors orphaned, strips `<w:proofErr>` spell-check markers, and run-coalesces unchanged headings and lists. **Severity: HIGH.** This is a regression from the original Phase 2 (NDA) testing where acceptance produced byte-equivalent run boundaries outside the change zone.

Two additional cosmetic findings (VAL-OBS-1 and VAL-OBS-2) noted in detail below.

**Phases B remainder, C, D — not yet executed.** Halting validation to surface the critical findings first since they affect the foundational accept-changes workflow.

---

## Phase A — Tech Debt Fixes (Complete and Verified)

### A1 — TECH-2: Heading Depth Validation ✅

| Test | Result |
|---|---|
| `####### h7` (7 hashes) | `BatchValidationError: Heading level 7 is not supported (maximum is 6).` |
| `############## h14` (14 hashes) | `BatchValidationError: Heading level 14 is not supported (maximum is 6).` |
| `###### h6` (boundary, 6 hashes) | Accepted; produces `<w:pStyle w:val="Heading6"/>` cleanly |

Boundary correct. Error message reports actual depth, allowing the LLM to self-correct. Atomic batch behavior preserved (no output file produced on validation failure). 139 ms validation latency.

### A2 — TECH-6: Table Error Message Wording ✅

| Test | Result |
|---|---|
| Attempt to insert a new table row via text replacement | "Structural table changes like adding/removing **rows or columns** are not supported via text replace." |

Wording corrected. **Adjacent finding worth noting:** the operation reports as `Edits: 0 applied, 1 skipped` (soft skip) rather than `Batch rejected` (hard fail). Consistent with original Phase 9.2 behavior — not a regression — but means an automation calling this with no observability of the `skipped` field could falsely believe the table was modified. See VAL-OBS-1 for proposed clarification.

### A3 — TECH-1: Live COM Author Override Warning ✅

Live-Word batch with `author_name="Outside Counsel AI"` against an active session logged in as "Mikko Korpela" returns:

> Live Word Batch complete. Applied: 1, Failed: 0.
> Warning: Live Word natively enforces M365 identities. The requested author_name ('Outside Counsel AI') may have been overridden by Word with the active user identity ('Mikko Korpela').

**Excellent wording.** "Live Word natively enforces" correctly locates the constraint at the Word layer (not the engine), so users won't blame the wrong system. Both the requested and actual identity are surfaced explicitly, which lets a calling agent self-correct or escalate to the user.

Cold-start latency dropped from 4042 ms in the original session to 549 ms (Word was already warm). Live COM batch was 403 ms.

### A4 — TECH-3: Table Cell Comment Anchoring ✅

Reproducing the original Phase 9.1 scenario (changing `**349.91**` to `**412.07**` in a row of 7 cells, with a `comment`):

**Before (original bug):** `<w:commentRangeStart>` anchored at the first cell ("Microsoft Corporation"), with the actual change 6 cells away.

**After (verified fix):**
```xml
<w:tc>
  <w:p>
    <w:commentRangeStart w:id="ID"/>
    <w:del>...349.91...</w:del>
    <w:ins>...412.07...</w:ins>
    <w:commentRangeEnd w:id="ID"/>
    <w:commentReference w:id="ID"/>
  </w:p>
</w:tc>
```

Comment range anchored to the actual changed cell. Range scope is *minimal* — wraps just the `<w:del>`/`<w:ins>` pair, not the full cell paragraph. **Significant UX improvement** for tabular legal exhibits.

### A5 — Markdown Italics Strictness ✅

`_proper italic_` → discrete `<w:r>` with `<w:i w:val="1"/>`. `*literal asterisks*` → preserved as literal characters in `<w:t>` with no italic formatting applied. Documentation and behavior aligned.

---

## Phase B — Track 1: Footnotes & Endnotes

### B.1 — Footnote Content Edit ✅ functionally PASS

Edit applied to footnote 2's content (`[^fn-2]: Footnote text [...].` → `[^fn-2]: This is a substantively rewritten footnote. _See_ Bluebook rule 1.1.`) correctly lands the `<w:del>` and `<w:ins>` blocks **inside `footnotes.xml`** (verified by the diff context showing `<w:footnoteRef/>` adjacency, which is unique to the footnote part).

Quality of the redline:
- Italic `_See_` produces correct `<w:r>` with `<w:i w:val="1"/>` ✓
- Plain text in surrounding runs ✓
- Comment range tightly scoped around the changed content ✓

### VAL-OBS-1 — Inconsistent w16du namespace declaration in footnotes (severity: LOW, cosmetic)

In document.xml, the engine declares `xmlns:w16du="..."` once at the root and then uses the `w16du:dateUtc` prefix on every `<w:del>` and `<w:ins>`:
```xml
<w:document xmlns:w16du="...">
  <w:del w:id="..." w16du:dateUtc="..."/>
```

In footnotes.xml, the engine **also** declares `xmlns:w16du` at the document.xml root (correctly) but then injects a *second* declaration with prefix `ns0` on every `<w:del>` and `<w:ins>` inside the footnote part:
```xml
<w:del xmlns:ns0="http://schemas.microsoft.com/office/word/2023/wordml/word16du" 
       w:id="ID" 
       ns0:dateUtc="DATE">
```

The same namespace URI is now bound to two different prefixes. Word accepts this, but:
- It's inconsistent — tools walking XML expecting `w16du:dateUtc` consistently across the document won't find it inside footnotes.
- It inflates file size with a redundant namespace decl on every footnote redline element.

**Recommendation:** unify namespace handling between the document.xml writer and the footnotes.xml writer. The footnote part should declare `xmlns:w16du` at its root and use the `w16du:` prefix consistently.

### VAL-OBS-2 — Newline run injected before tracked footnote edit (severity: LOW, possibly intentional)

Before the tracked change, an extra run appears containing only a literal newline:
```xml
<w:r>
  <w:t xml:space="preserve">
</w:t>
</w:r>
<w:commentRangeStart>...
```

The original footnote was a single run with leading space. The engine has split it: leading space → newline run, then the tracked change. Word renders the newline as a soft break or space, but it's unusual. May be intentional anchoring behavior; worth a focused test on whether Word renders the footnote correctly without doubled spacing.

### B.2 — Accept Changes on Footnote Redline ❌ **CRITICAL BUG**

#### VAL-CRIT-1 — `accept_all_changes` skips footnotes.xml (severity: HIGH)

After applying B.1's footnote edit and running `accept_all_changes`:

- The body of `document.xml` was traversed and modified.
- The `<w:del>` and `<w:ins>` blocks **inside `footnotes.xml` were NOT processed**. They survive intact in the "accepted" output.

This means a document with both body redlines and footnote redlines, after `accept_all_changes`, will have:
- Body redlines: cleanly accepted, no markup remaining.
- Footnote redlines: still showing as track-changes markup.

**Impact:** an attorney pressing "accept all changes" before sending a document to counterparty will leak footnote-level redlines back to the counterparty. The silent-change-detection workflow that depends on a clean post-acceptance state is broken for any document with footnote edits.

**Suspected cause:** the `accept_all_changes` walker is iterating over `document.xml` only and not traversing `footnotes.xml` / `endnotes.xml` / `header*.xml` / `footer*.xml`. The same gap likely affects all auxiliary parts.

**Recommendation:** the acceptance walker needs to operate on the union of all parts containing trackable content: `document.xml`, `footnotes.xml`, `endnotes.xml`, every `header*.xml`, every `footer*.xml`, and `comments.xml` (for replies). The redline writer already correctly targets `footnotes.xml` for footnote edits, so the writer side knows about the part inventory — the acceptance walker needs the same awareness.

#### VAL-CRIT-2 — `accept_all_changes` performs unintended document rewrite (severity: HIGH)

When applied to a document that had *only* a body-content tracked change (no footnote redline at all), `accept_all_changes` produces these unintended mutations to **regions with no track changes**:

1. **Pre-existing comment markers stripped.** A pre-existing comment ("Table" → "[Com:0] Nora Devlin advises on TOC update") had its `<w:commentRangeStart>` and `<w:commentRangeEnd>` markers removed, while the `<w:comment>` element in `comments.xml` and the `<w:commentReference>` run survived. **The original comment is now orphaned and will display incorrectly in Word.**

2. **`<w:proofErr>` spell-check markers stripped** throughout the document. These are Word's spell/grammar squiggle annotations — not redlines, not user content. They should be preserved.

3. **Aggressive run coalescence on unchanged content.** Heading text runs that were originally split into multiple `<w:r>` elements (e.g., `Introduction` + ` [ctrl-alt-1]` as two runs) get coalesced into single runs. This is technically OOXML-equivalent output but represents a **regression** from the original Phase 2 behavior, where `accept_all_changes` produced byte-stable run boundaries outside the change zone.

**Why this matters for the legal demo:**
- Silent-change detection is the operator's headline feature. It depends on `compare_clean=True` being able to distinguish "the document was changed" from "the document was processed by Adeu." If `accept_all_changes` rewrites large regions with no tracked changes, then any document that has been through Adeu acceptance will diff *differently* from the same document hand-edited in Word — even when the substantive change is identical. This pollutes the diff signal.
- Orphaned comments (issue 1 above) are a correctness bug that will be visible to reviewers.

**Suspected cause (best guess):** the acceptance walker is doing more than removing `<w:del>`/`<w:ins>` markers — it appears to be re-serializing the document through a normalization pass that strips proof-err markers, drops standalone comment range markers it doesn't recognize as belonging to a tracked change, and coalesces adjacent `<w:r>` siblings.

**Recommendation:** acceptance should be a **targeted** transformation. Walk only redline elements (`<w:ins>`, `<w:del>`, `<w:moveFrom>`, `<w:moveTo>`, paragraph-mark `<w:rPr>/<w:del>` and `<w:rPr>/<w:ins>` markers) and process them in place. Leave everything else byte-identical. Comment range markers should only be removed when the *comment they belong to* is being deleted, not as a side effect of touching nearby track-changes.

---

## Phases B (footnote insert/delete), C (Track 2 links), D (Track 3 appendix) — Not yet executed

I'm halting the validation pass after surfacing VAL-CRIT-1 and VAL-CRIT-2 because:

1. Both bugs are in the foundational `accept_all_changes` code path, which all downstream workflows depend on.
2. VAL-CRIT-2 in particular is a regression that would damage the silent-change-detection demo if shipped as-is.
3. Continuing to validate Track 2 (link retargeting) and Track 3 (read-only appendix) until acceptance is correct risks finding more issues that are actually downstream symptoms of the acceptance walker bugs.

Once VAL-CRIT-1 and VAL-CRIT-2 are addressed, the remaining validation phases I'd run are:

- **B.3** — delete an entire footnote (does it remove the inline `[^fn-N]` marker, the `## Footnotes` body entry, and the underlying `<w:footnote>` element atomically?)
- **B.4** — insert a new footnote reference (likely should refuse, like table row inserts)
- **B.5** — verify diff_docx_files (`compare_clean=True`) detects silent footnote changes — the silent-change-detection feature must extend to footnotes for the legal demo
- **C.1–C.5** — Track 2 hyperlink retargeting (silent URL update via `_rels`), display-text edit, both-edit, cross-reference rejection (display text edit, hash edit)
- **D.1–D.5** — Track 3 structural appendix (verify it accurately reflects bookmarks, attempt to edit text past the boundary marker, attempt various "trick" attacks to mutate the appendix content)

These phases are ready to execute as soon as the acceptance walker is fixed.

---

## Recommended Test Fixtures (for follow-up)

The Volokh-derived `jcul-article-template-11-24-20.docx` is an excellent fixture for Tracks 1 and 3 but does NOT exercise Track 2 (hyperlinks/cross-refs) — its TOC entries appear to be plain text rather than `<w:fldSimple>` cross-references, and it has no `<w:hyperlink>` elements. To validate Track 2, a fixture is needed that contains:
- At least one external `<w:hyperlink r:id="...">` linking to an `https://` target
- At least one internal `<w:hyperlink w:anchor="...">` linking to a bookmark
- At least one `<w:fldSimple w:instr="REF _Ref...">` cross-reference

A short hand-built fixture (1–2 pages) covering these would be both more controllable and more diagnostic than a real-world document.

---

## Appendix — Performance Notes

| Operation | Time |
|---|---|
| `read_docx` on jcul template | (rendered as widget; not measured separately) |
| `process_document_batch` 1-edit on footnote | 225 ms |
| `process_document_batch` 1-edit on body | 238 ms |
| `accept_all_changes` (footnote — buggy) | 113 ms |
| `accept_all_changes` (body — partly buggy) | 103 ms |
| `debug_xml_diff` between template and edited | 105 ms |
| `open_word_document` warm | 549 ms |
| Live COM batch (warm) | 403 ms |
| `save_active_word_document` + close | 307 ms |

All performance characteristics are consistent with the original session.
