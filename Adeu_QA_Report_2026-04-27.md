# Adeu Engine — Final QA & Product Report

**Date:** 2026-04-27
**Author:** Senior QA Engineer (exploratory test session)
**Scope:** Technical QA across seven structured phases, plus a domain-level review of the Markdown projection from the perspective of practicing legal review.
**Test files used:**
- `260204 Mutual NDA Template.docx` (~12 KB OOXML, simple prose + bulleted lists)
- `veryBigDoc.docx` — Microsoft FY2024 Annual Report (~285 KB markdown projection, complex tables, headings, hyperlinks)

**Test mode:** `ADEU_ENABLE_TEST_TOOLS=1` (timing footers + `debug_xml_diff` enabled)

---

# Part I — Executive Summary

The Adeu engine is **structurally sound and demo-ready for the NDA-class workflow**: silent-change detection, redline lifecycle, and pre-send-back sanitization all work as the operator described. The Markdown→OOXML translation is faithful, run coalescence on accept produces hand-edit-quality output, and the engine correctly refuses structural operations it cannot do safely (notably table row insert/delete) rather than producing corrupted documents.

For the **complex-contract-class workflow** (M&A SPAs, credit agreements, anything reference-heavy) the engine is doing strong work at the prose layer but is operating without visibility into the structural layer that defines how legal documents actually function. This is not a code bug — it's an abstraction-level gap. The Markdown projection optimizes for prose; legal work optimizes for structure. Closing this gap is the largest product opportunity surfaced by this review.

The findings below split into two categories:

- **Part II — Technical findings**: bugs, footguns, and behavioral surprises in the engine itself. These are concrete things to fix in code.
- **Part III — Domain visibility gaps**: places where the engine technically works but the abstraction it presents hides information an attorney needs. These are roadmap items for the product, not bug fixes.

---

# Part II — Technical Findings

## Test phase results matrix

| # | Phase | Result | Headline |
|---|---|---|---|
| 1 | Markdown structural injection (heading + bold + italic + paragraph splits) | ✅ PASS | All Markdown constructs translate to correct OOXML; no literal `#`/`*`/`_` survives in `<w:t>` |
| 2 | Redline lifecycle & run coalescing | ✅ PASS | Adjacent `<w:del>`/`<w:ins>` siblings coalesce on accept; bold rPr preserved across redline |
| 3 | Live COM vs Disk parity | ✅ PASS w/ caveats | Edit semantics identical; envelope diverges due to Word normalization. **Live COM ignores `author_name`** |
| 4 | Silent-change detection | ✅ PASS | `compare_clean=True/False` modes complementary and demo-ready |
| 5 | Sanitization | ✅ PASS | `keep_markup` and full sanitize both clean; report is auditable; rsids/paraIds/creator metadata stripped |
| 6 | Performance scaling | ✅ PASS | Batching amortizes well; per-edit cost ≈ 0 once doc is parsed |
| 7 | Edge cases (XML escaping, deletion, escapes, headings) | ✅ PASS w/ 1 footgun | XML escaping correct; backslash escapes literal; **`#######+` headings silently accepted** |
| 8 | Lists & numbering | ✅ PASS (single-level only) | Bullet insert/delete preserves `<w:numPr>`; multi-level nested lists not tested |
| 9 | Tables | ✅ PASS w/ correct refusals | Diff-aware cell editing is excellent; row insert/delete correctly refused |
| 10 | Cross-references | ⚠️ MOSTLY UNTESTED | Plain-text refs work as text; field codes / bookmarks / real hyperlinks unverified |

## Performance profile

| Operation | Small NDA (~12 KB) | veryBigDoc (~285 KB) |
|---|---|---|
| Single-edit batch (disk) | 109 – 162 ms | 7990 – 8345 ms |
| 5-edit batch (disk) | n/a | 6874 ms |
| Live COM batch (warm) | 333 ms | not tested |
| `open_word_document` (cold start) | 4042 ms | n/a |
| `save_active_word_document` | 247 ms | n/a |
| `accept_all_changes` | 78 – 96 ms | n/a |
| `debug_xml_diff` | 34 – 86 ms | 9210 – 12145 ms |
| `diff_docx_files` (clean) | 67 – 79 ms | not tested |
| `diff_docx_files` (raw) | 80 ms | 4076 ms |
| `sanitize_docx` (keep_markup) | 84 ms | n/a |
| `sanitize_docx` (full) | 44 ms | n/a |

**Scaling shape:** super-linear in document size, dominated by parse/serialize cost. Per-edit cost within a batch is essentially free. Recommendation: always batch.

---

## Confirmed bugs and behavioral problems

These are concrete issues observed during testing, in roughly descending order of severity for the legal use case.

### TECH-1 — Live COM silently overrides `author_name` for tracked changes (severity: HIGH for legal use)

**Observed in:** Phase 3.

**What happens:** When `process_document_batch` is called via the live Word COM bridge (empty `original_docx_path`), the `author_name` parameter is silently ignored for tracked changes — Word stamps revisions with the M365 logged-in user's identity instead.

```diff
- <w:ins w:author="QA-Adeu-Phase3-Disk" .../>      ← what disk path emits
+ <w:ins w:author="Mikko Korpela" .../>            ← what COM emits
```

**Why this matters:** the tool description warns about this for *comments* but doesn't make it crystal clear it also applies to *track changes*. An attorney expecting redlines to be authored as "Outside Counsel" or "Reviewer AI" will see their own M365 identity on every redline applied via live Word. For an audit trail in a negotiated contract this is materially wrong.

**Recommendation:** the live-COM batch response should explicitly surface `"author_overridden_by_word": "<actual identity>"` when this happens, so the calling agent knows the audit trail won't reflect what was requested. Document the limitation prominently in `process_document_batch`'s description (it currently only mentions comments).

### TECH-2 — Heading levels above 6 silently accepted (severity: MEDIUM, footgun)

**Observed in:** Phase 7, test 3.

**What happens:** Sending `####### Seven-hash heading` (7 hashes) is accepted without warning and emitted as `<w:pStyle w:val="Heading7"/>`. Most templates do not define `Heading7` style; the result is a paragraph that doesn't render visually as a heading even though the user asked for one.

**Why this matters:** a user who fat-fingers `#######` instead of `######` gets silent visual breakage in the final document. In a contract this could mean a section heading rendering as body text and breaking the document's outline.

**Recommendation:** validate Markdown heading depth in `process_document_batch`. Either clamp to `Heading6` and return a warning in the batch response, or fail validation with a clear error. The tool description already says it supports `# Heading 1` through `###### Heading 6` — enforce that contract.

### TECH-3 — Comment range anchored to wrong cell in tables (severity: MEDIUM, UX)

**Observed in:** Phases 9.1 and 9.4.

**What happens:** when an edit changes content inside a specific table cell, the `<w:commentRangeStart>` / `<w:commentRangeEnd>` markers wrap the **first cell of the row** rather than the cell that actually changed. A reviewer in Word sees the comment bubble next to "Microsoft Corporation" while the actual change is in the rightmost cell of a 7-cell row.

**Why this matters:** in a 12-column financial table or comparison schedule, the reviewer scanning the comment indicator may literally not see what the comment refers to. Comments are how attorneys flag rationale for non-trivial changes; misanchored comments degrade the review experience.

**Recommendation:** when the edit lands inside a `<w:tc>`, anchor the comment range to that cell, not to the row's leading cell.

### TECH-4 — Spurious empty `<w:ins>` between `commentRangeStart` and `commentRangeEnd` (severity: LOW, cosmetic)

**Observed in:** Phase 8.1 (list item insertion with multi-paragraph payload).

**What happens:** when a multi-paragraph replacement matches an existing paragraph as its first segment and appends new paragraphs after it, the original paragraph's edit zone contains an empty self-closing `<w:ins>` element:

```xml
<w:commentRangeStart w:id="ID"/>
<w:ins w:id="ID" w:author="..." w:date="DATE" .../>   ← empty, no children
<w:commentRangeEnd w:id="ID"/>
```

**Why this matters:** Word handles this gracefully (it's valid OOXML), but it's noise that could confuse downstream tools that walk the tree. It also slightly inflates package size when many such edits are applied.

**Recommendation:** suppress empty `<w:ins>` emission when no content was inserted at that position.

### TECH-5 — `debug_xml_diff` masks rsid/paraId scrubbing claims (severity: LOW, observability)

**Observed in:** Phase 5.

**What happens:** `debug_xml_diff` normalizes `w:id`, `w:date`, `w14:paraId`, `w:rsid*` etc. to placeholder strings (`ID`/`DATE`/`PID`/`RID`) for readability. This is great for reading regular diffs but actively hides exactly the metadata that `sanitize_docx` claims to be removing. The sanitize report claims "466 rsid attributes removed" but the diff shows nothing of the kind because both sides are normalized to the same placeholders.

**Why this matters:** users running sanitize to verify no fingerprints leak before sending a contract to counterparty have no programmatic way to confirm the claim against the actual XML. They have to trust the report.

**Recommendation:** add an opt-in `show_raw_ids: bool = False` parameter to `debug_xml_diff` that disables ID normalization. Sanitization verification is the use case where this matters.

### TECH-6 — Error message wording inconsistency on table structural changes (severity: TRIVIAL)

**Observed in:** Phase 9.2 and 9.3.

**What happens:** the engine refuses table row insertion/deletion with the message:
> "Structural table changes like adding/removing **columns** are not supported via text replace."

But the operations refused were row inserts/deletes, not column ones.

**Recommendation:** update wording to "rows or columns."

### TECH-7 — Backslash escapes preserved literally (severity: LOW, design choice worth confirming)

**Observed in:** Phase 7, test 4.

**What happens:** `\*not bold\*` survives into the OOXML as literal `\*not bold\*`. A conventional Markdown processor would consume the backslashes and emit `*not bold*`. The engine takes a "preserve everything the user typed" approach.

**Why this matters:** for legal documents this is probably the *right* call — losing characters is worse than keeping them — but it should be explicit policy, not accidental. Users coming from standard Markdown will be surprised.

**Recommendation:** document the escape policy explicitly in `process_document_batch`. If `\*` should be treated as literal `*`, say so. Either behavior is defensible.

### TECH-8 — Persistent `w16du` namespace fingerprint after sanitize (severity: LOW)

**Observed in:** Phase 5.

**What happens:** after sanitization, `xmlns:w16du="…/word16du"` remains on the root `<w:document>` element even when no element in the body now references it. The engine added it during edit; sanitize doesn't remove it.

**Why this matters:** it's a stylistic fingerprint that says "this document was touched by a track-changes-aware tool." Not a leak per se, but on a fully sanitized "as if hand-typed" closing document it stands out.

**Recommendation:** during sanitize, prune unreferenced namespaces from the root element. Low priority but tightens the polish.

---

## Confirmed strengths worth preserving in any refactor

These are behaviors that work especially well and shouldn't regress.

### TECH-S1 — Diff-aware minimal redlines

Phase 9.4 demonstrated that when a multi-word replacement has a common prefix and suffix with the original, the engine correctly identifies the unchanged portions and emits a tracked change scoped to only the changed middle. This produces `<w:del>old text<\w:del><w:ins>new text<\w:ins>` flanked by **unchanged runs** on both sides — exactly what a careful human redliner would do. Naïve engines replace the entire matched span, generating noisy redlines.

### TECH-S2 — Run-property preservation across redlines

Phase 2 demonstrated that bold (`<w:b/>`), italic (`<w:i/>`), and font-family `<w:rPr>` are preserved on both halves of a `<w:del>`/`<w:ins>` pair. After acceptance the run coalesces back to a single `<w:r>` with the original `<w:rPr>` intact. For legal documents this prevents the "the duration value lost its bold formatting" silent visual change.

### TECH-S3 — Atomic batch validation

Phase 7 demonstrated that when one edit in a batch fails (target text not found), the entire batch is rejected with a clear error and no partial state is written. This is critical for agent-driven workflows: a 50-rule playbook either applies completely or not at all.

### TECH-S4 — Refusing what cannot be done safely

Phase 9.2 and 9.3: table row insertion/deletion is **refused with a clear error message** rather than producing corrupted tables. This is the right disposition — it's better to tell the user "use Word for this" than to silently fabricate broken `<w:tr>` elements.

### TECH-S5 — XML escaping is correct

Phase 7 demonstrated that `<`, `>`, and `&` in user-supplied replacement text are properly escaped to `&lt;`, `&gt;`, `&amp;` in the resulting OOXML. There is no markdown-injection vector — users cannot smuggle raw XML through the engine.

### TECH-S6 — `accept_all_changes` produces hand-edit-quality output

Phase 2 showed that after acceptance, the document XML is structurally indistinguishable from the same edit made manually in Word — same run boundaries, same `<w:rPr>`, no orphan elements. The accepted document can be sent to counterparty without any "obviously machine-generated" tells.

### TECH-S7 — Batched edits amortize beautifully

Phase 6: a 5-edit batch on a 285 KB document took **less time than a 1-edit batch** because the parse/serialize cost dwarfs per-edit logic. PADU playbooks running dozens of rules at once will perform fine.

### TECH-S8 — Sanitization report is auditable in plain English

Phase 5: the report enumerates every accepted change ("Accepted insertion: 'seven (7) years'"), every removed comment with its original author, every metadata field scrubbed (e.g., `Author: Ville Sinisalo`), and counts of structural cleanups (rsids, paraIds). An in-house team can review the report before sending and have confidence about exactly what was removed.

### TECH-S9 — Bullet list inheritance on insertion

Phase 8.1: a new bullet inserted via a multi-paragraph replacement correctly clones `<w:numPr>` (numId, ilvl, indentation, spacing, fonts) from the source paragraph. The new bullet renders as a continuation of the same list. Renumbering is automatic at Word's render time.

---

## Coverage gaps worth closing before legal sales demo

| Construct | Coverage | Risk if untested |
|---|---|---|
| Multi-level numbered lists (1.1, 1.1.1, 1.2, …) | ❌ Untested | The dominant outline structure in real contracts; if the engine flattens or mishandles `<w:ilvl>` levels, complex contracts will round-trip incorrectly |
| Field-coded cross-references (`<w:fldSimple>`, `<w:fldChar>`) | ❌ Untested | If editing the rendered text destroys the field, every "as defined in Section X" reference becomes stale |
| Genuine `<w:hyperlink r:id="...">` constructs | ❌ Untested | Hyperlinks in modern contracts often link to defined-term glossaries or external schedules; lossy round-trip would silently strip them |
| Bookmarks (`<w:bookmarkStart>`) | ❌ Untested | Foundation of cross-reference targets; deleting a bookmarked paragraph could orphan upstream `<w:fldSimple>` references |
| Footnotes / endnotes | ❌ Untested | Heavily used in opinion letters and offering memoranda; live in separate `footnotes.xml` part with own paragraph numbering |
| Headers / footers with track changes | ❌ Untested | Live in `header*.xml` / `footer*.xml`; track-change behavior here is sometimes asymmetric in OOXML engines |

**Strong recommendation:** before the legal sales demo, source one well-structured contract template — a real M&A SPA, a credit agreement, or a complex licensing deal — that exercises all six of the above constructs. Run the test methodology from Phases 1–10 against it. An afternoon of testing closes the biggest remaining technical risk.

---

# Part III — Domain Visibility Gaps

This section steps out of QA-engineer mode and into the seat of an attorney trying to use the tool to do legal review. The question is: when I look at a document through Adeu's Markdown projection, what can I trust myself to see, and where am I flying blind?

These are not bugs. The engine is doing what it's designed to do. They are gaps in the *abstraction* the engine presents — places where the tool technically works but the projection hides information an attorney needs to make confident decisions.

## Where the projection serves legal work brilliantly

Before the gaps, it's worth being precise about what works.

**Substantive content review is genuinely good.** Reading the NDA through `read_docx` produces a clean rendering that parses like the document — heading hierarchy, emphasis from bold, list items as bullets. Cognitive load is low. An attorney reads contracts, not OOXML.

**Redlining operates at the level of meaning, not characters.** When a multi-paragraph replacement targets a list item, the resulting tracked change reads as "split this bullet into two" — which is the level a senior attorney thinks at ("split obligation 3 into a notification duty and an access-restriction duty"). The projection makes that translation possible.

**Silent-change detection is the killer feature.** This cannot be overstated for the negotiation use case. The dominant fear in contract review is the counterparty modifying a number, a definition, or a governing-law clause without redlining it. Most diff tools — including Word's own Compare — drown that signal in noise from rsids, paraIds, and Word's autosave normalization. Adeu's clean diff strips those and shows only the semantic delta. The Phase 4 address change was caught instantly. **For this use case alone the tool is worth deploying.**

**The CriticMarkup raw view gives attorneys the audit story** — who changed what, when, with what comment. The contrast between "this delta has a `{-- --}/{++ ++}` audit trail" and "this delta has no markup, it just appeared" is exactly the visual cue needed to spot smuggled changes. An attorney trained on five seconds of reading the format becomes effective at spotting manipulation.

**Sanitization closes the loop deployably.** One button to strip rsids, replace internal authors, scrub the original drafter's identity, and produce an auditable report — that's a complete workflow most legal-tech tools don't offer.

**Markdown forces normalization across environments.** The same NDA opened in Word by three different users renders differently because of local style defaults. The Markdown projection collapses that variance — `**bold**` is `**bold**` regardless of local Word installation. PADU playbooks can match consistently across users. Quietly important for production reliability.

**Find-side and write-side speak the same language.** The user matches against the same projection the read-side gave them. There's no impedance mismatch where reading bold is `**` but writing bold needs `<b>`. Subtle but adds up across hundreds of edits.

## Where the projection blinds attorneys — and the stakes get high

The Markdown projection is a **lossy abstraction**, and the losses are concentrated exactly where structured legal work lives.

### DOMAIN-1 — Defined terms and their reference network are invisible (severity: HIGH)

A professional law-firm contract has a defined-terms section where every capitalized term — *Affiliate*, *Closing*, *Material Adverse Effect* — is anchored by a `<w:bookmarkStart>`. Every use of that term throughout the document is typically a `<w:fldSimple w:instr="REF _Ref...">` field that auto-updates if the bookmark target changes.

Through Adeu, an attorney sees "Affiliate" as a plain word. They have **no way of knowing**:
- It's a defined term (vs. an ordinary use of the word "affiliate")
- 47 places downstream reference it
- Renaming it requires updating every reference

If the attorney accepts a tracked change that renames "Affiliate" to "Group Company," the local rename works, but every downstream cross-reference still says "Affiliate" because the field codes point at the renamed bookmark. The document becomes inconsistent and the inconsistency is invisible through the projection.

This is the gap that worries me most. A senior partner reviewing a credit agreement is mentally tracking, at all times, "where else does this term appear?" If the tool doesn't surface that, the partner has to flip back to Word — and at that moment the workflow is lost.

**What would close this gap:** a sidecar query that returns, for any matched text, a list of the defined-terms it contains and the count of usage sites for each. Even better: an explicit `defined_terms_inventory()` tool that returns the entire defined-terms graph with bookmark IDs and usage sites.

### DOMAIN-2 — Outline numbering carries semantic weight that gets flattened (severity: HIGH)

In a real M&A SPA, "Section 5.7(b)(iii)" isn't decorative — it's an anchor that other clauses, schedules, and side letters point to. Schedules cross-reference "the indemnification cap in Section 9.2." Side letters carve out "exceptions to Section 7.4."

The Markdown projection shows "* something" or "1. something" without telling the attorney the position in the outline tree. If a sub-clause is deleted and the document renumbers, there's no way through the projection to verify whether anything else references the renumbered position.

This is the same root cause as DOMAIN-1, but specifically for **implicit** references humans make when reading "the indemnification cap in Section 9.2" — the human says "Section 9.2" the way they say "page 47," not as a defined term, but as a positional anchor. The engine has no way to flag that "Section 9.2" is actually the rendered output of a `<w:fldSimple w:instr="REF _Ref9_2">` field that will silently change if the underlying section is renumbered.

**What would close this gap:** an outline-tree representation surfaced alongside the Markdown projection, showing the actual numbered structure of clauses. Combined with a "where is this clause referenced?" query.

### DOMAIN-3 — Footnotes are a black hole (severity: MEDIUM-HIGH)

Footnotes in OOXML live in a separate `footnotes.xml` part. They have their own paragraph numbering, their own track-changes lifecycle, and they're heavily used in:

- Scholarly legal work (law review articles, treatises)
- Opinion letters (the substantive analysis often lives in footnotes)
- Offering memoranda (risk factors and disclosures)
- Tax memoranda (citations to IRC sections, Treasury regulations)

I could not test footnote behavior because the supplied documents had none. **If the projection drops footnotes or surfaces them out of position, edits could land in the wrong context.** Worse: a counterparty silently changing footnote 47 — which contains the only definition of "Material Adverse Effect" — would not be caught by the silent-change detection workflow if the projection doesn't include footnote content in the comparison.

**What would close this gap:** explicit support for reading and editing footnotes/endnotes; surfacing them in the projection with anchor markers (e.g., `[^47]` syntax) so they can be edited in context.

### DOMAIN-4 — Defined-term italics are the only signal distinguishing definitions from uses (severity: MEDIUM)

Many contracts have a "Definitions" section where each entry looks like *"Affiliate*" means..." with the term italicized. When the term is used elsewhere, it's typically capitalized but unformatted. The visual cue (italic vs. roman) is the only signal in the projection that distinguishes a definition from a use.

This means an attorney scanning for "where is this defined?" must visually parse italics across the document. There's no programmatic affordance.

**What would close this gap:** treat italicized capitalized terms as candidate definitions; expose this as a queryable inventory.

### DOMAIN-5 — Tables of contents and tables of authorities are invisible as such (severity: MEDIUM)

These are usually field-generated (`<w:fldSimple w:instr="TOC ..."/>`). The projection shows the rendered text — a list of headings — but the attorney has no way to know it's a TOC.

If the attorney edits a heading earlier in the document, the TOC entry doesn't update through the projection layer; the user has to know to ask Word to refresh fields. Worse: a `compare_clean=True` diff between proposal and counterparty-response will show TOC differences as "the counterparty changed these heading texts," when in reality the counterparty changed the underlying headings and the TOC just reflects that. False positives erode trust in the silent-change detection.

**What would close this gap:** detect TOC/TOA fields and either (a) suppress them from the projection with a marker, or (b) flag in diff output that "this delta is in an auto-generated TOC and likely reflects upstream heading changes."

### DOMAIN-6 — No way to ask "what did *this contributor* change between v2 and v3?" (severity: MEDIUM)

I tested current-round comments and they work well. But contracts often arrive on round 4 of a negotiation with redlines from rounds 1–3 still visible. The projection through `clean_view=True` shows me the post-acceptance state; the raw projection shows me CriticMarkup with author attribution.

**Neither gives me a clean way to filter by contributor.** Question I cannot answer through current tooling: "show me only the changes Counterparty Counsel made between the v2 and v3 redlines, ignoring the changes In-House Counsel made on the same draft."

This matters because in multi-round negotiations, the actually-interesting question is rarely "what's different between v2 and v3?" — it's "what did *they* push in this round?" An in-house attorney seeing 200 redlines on a returned contract wants to triage by author first.

**What would close this gap:** an author-filtered diff mode, or an "author rollup" report showing each contributor's net changes.

### DOMAIN-7 — Genuine hyperlinks vs. URL-shaped text are indistinguishable (severity: LOW-MEDIUM)

Phase 10.5 demonstrated this concretely. The string `https://www.computershare.com/Microsoft` appeared in the projection as plain text. I edited it with no error. The diff showed no `<w:hyperlink>` element involvement.

**But:** I did not have a test document where the hyperlink was an actual `<w:hyperlink r:id="rId7">click here</w:hyperlink>` construct, where the URL lives in `_rels/document.xml.rels` and the visible text says "click here" in the body. If a user edits "click here" through the markdown layer, it is unclear whether the engine preserves the parent `<w:hyperlink>` wrapper or quietly degrades it to plain text.

**What would close this gap:** test with a document containing genuine OOXML hyperlinks; ensure the engine either passes the `<w:hyperlink>` wrapper through unmodified or surfaces the link target in the projection (e.g., as `[click here](https://...)` markdown syntax).

### DOMAIN-8 — Comment anchoring inside complex layouts (severity: MEDIUM)

Already covered as TECH-3 from a code perspective. From the domain perspective: in a 12-column financial table, a comment intended to flag rationale for a specific cell change appears anchored to the leftmost cell. A reviewer scanning the comment indicator sees a comment next to "Microsoft Corporation" and may not realize the actual change is six columns over.

This isn't just a code bug — it changes whether comments are *useful* in tabular legal exhibits (term sheets, pricing schedules, comparison tables). If the reviewer can't trust comment placement, they stop attaching comments, and the audit trail degrades.

### DOMAIN-9 — No surfacing of which clauses contain or depend on the edited region (severity: HIGH for complex contracts)

The deepest problem subsumes several of the above. Legal work is fundamentally about **dependency tracking**: this clause limits that one, this definition feeds those references, this representation triggers that indemnification.

The Markdown projection shows the document as a flat sequence of paragraphs. It doesn't expose:

- Which paragraphs are inside which sections
- Which sections are cross-referenced by which other sections
- Which terms are defined where and used where
- Which clauses are part of a structured construct (e.g., a defined-term entry, a representation, a covenant, an indemnification basket)

For an attorney editing one clause, the natural follow-up question is always "what else does this affect?" The current tooling can't answer.

**What would close this gap:** the structural sidecar described below.

## The deeper diagnosis

Stepping back: the abstraction the engine has chosen — Markdown — is excellent for **prose-dominated documents**. NDAs, simple service agreements, internal memos, the kind of thing where 95% of the meaning is in the sentences. The Microsoft annual report I tested fits this profile too, despite being long.

But the documents that drive the most attorney revenue per hour — credit agreements, SPAs, indenture trustees, complex licensing — are **structure-dominated**. The clauses themselves are often boilerplate; what matters is which clause references which other clause, and how the defined terms thread through. A 60-page credit agreement might have only 8,000 words of unique prose; the rest is structure and reference.

For that class of work, what I'd want from the projection is not just the text, but a **structural index** that surfaces:

1. **A defined-terms inventory** — every term with a definition somewhere, with bookmark IDs and a count of usage sites.
2. **A cross-reference graph** — every `<w:fldSimple>` field, what it points to, and what it currently renders as.
3. **An outline tree** — the actual numbered structure of clauses, so a renumber operation can be detected and handled.
4. **A footnote/endnote list** — separate from body content so it can be reviewed in its own context.
5. **A hyperlink inventory** — distinguishing genuine `<w:hyperlink>` constructs from text that happens to look like a URL.

These wouldn't replace the Markdown projection. They'd **augment** it — sidecar representations that an attorney (or an AI agent assisting them) could query: *"before I rename 'Affiliate' to 'Group Company,' show me everywhere it's used as a defined-term reference."*

---

# Part IV — Recommendations Summary

## Immediate (fix before legal sales demo)

| ID | Item | Effort | Impact |
|---|---|---|---|
| TECH-1 | Surface live-COM author override in batch response | Small | High |
| TECH-2 | Validate Markdown heading depth ≤ 6 | Small | Medium |
| TECH-3 | Anchor comment ranges to actual edited cell, not row's first cell | Medium | Medium |
| TECH-6 | Fix wording in table-structural-change error message | Trivial | Low |

## Short-term coverage gaps to close

| Item | Effort | Impact |
|---|---|---|
| Test multi-level numbered lists end-to-end | Medium (need source doc) | High |
| Test field-coded cross-references | Medium (need source doc) | High |
| Test genuine `<w:hyperlink>` constructs | Small (need source doc) | Medium |
| Test footnotes / endnotes | Small (need source doc) | Medium |
| Test headers / footers with track changes | Small | Medium |

**One test contract — a real M&A SPA, credit agreement, or licensing deal — would exercise all five at once.**

## Medium-term technical polish

| ID | Item |
|---|---|
| TECH-4 | Suppress empty `<w:ins>` emission |
| TECH-5 | Add `show_raw_ids` toggle to `debug_xml_diff` for sanitize verification |
| TECH-7 | Document backslash-escape policy explicitly |
| TECH-8 | Prune unreferenced namespaces during sanitize |

## Long-term product direction (the real opportunity)

The biggest unlock is the **structural sidecar**: surface to the user (or to an AI agent acting on their behalf) the structural information that the Markdown projection necessarily flattens.

| Capability | What it enables |
|---|---|
| `defined_terms_inventory()` | "Where is *Affiliate* defined and used?" — answer programmatically |
| `cross_reference_graph()` | "If I renumber Section 5.7 to 5.8, what fields will silently restate?" |
| `outline_tree()` | Detect renumber operations; warn before they break references |
| `footnote_list()` | First-class footnote editing and silent-change detection on footnotes |
| `hyperlink_inventory()` | Distinguish real OOXML hyperlinks from URL-shaped text |
| Author-filtered diff mode | "Show me only Counterparty's net changes between v2 and v3" |

## Strategic positioning recommendation

The temptation in legal-tech sales is to demo the slickest contract and pretend the tool handles it as well as it handles a simple NDA. That works once. The second time, when the partner asks "okay, now show me what other clauses reference the indemnification cap I'm changing" and the tool can't, the credibility hit is permanent.

For the **NDA-class workflow** (proposal vs. counterparty-response, silent-change detection, sanitization), the tool is genuinely strong and should be the lead-with story. The Markdown projection is the right level of abstraction for this work, and the diff/sanitize/redline tooling around it is genuinely valuable.

For the **complex-contract-class workflow** (M&A, credit agreements, anything reference-heavy), be honest in those conversations or build the structural sidecar first. The brightest opportunity is actually the **combination** of strong prose handling and a structural sidecar. No major legal-tech tool I'm aware of does both well:

- The companies that do diff well (Litera Compare, Litigation tools) don't have agentic editing.
- The companies that do agentic editing (the various GenAI-for-contracts startups) typically don't expose the OOXML faithfully and so can't be trusted on the silent-change detection question.

Adeu has a credible path to be **the** tool that does both — but only if the structural gap is acknowledged and addressed.

---

# Appendix A — Test Artifacts

All files produced during testing are at the listed paths.

**Under `C:\Users\mikko\Desktop\NDAExample\`:**
- `nda_phase1_markdown_inject.docx` — Phase 1 (structural injection)
- `nda_phase2_redline.docx`, `nda_phase2_accepted.docx` — Phase 2 (redline lifecycle)
- `nda_phase3_live.docx`, `nda_phase3_disk.docx` — Phase 3 (live vs disk parity)
- `nda_phase4_step1_silent.docx`, `nda_phase4_step2_baked.docx`, `nda_phase4_counterparty_response.docx` — Phase 4 (silent-change scenario)
- `nda_phase5_sanitized_keepmarkup.docx`, `nda_phase5_sanitized_full.docx` — Phase 5 (sanitization)
- `nda_phase7_edge.docx` — Phase 7 (edge cases)
- `nda_phase8_list_insert.docx`, `nda_phase8_list_delete.docx`, `nda_phase8_list_delete_accepted.docx` — Phase 8 (lists)
- `nda_phase10_section_rename.docx` — Phase 10.1 (plain-text refs)

**Under `C:\Users\mikko\workspace\docx-md-docx\`:**
- `veryBigDoc_phase6_edit.docx`, `veryBigDoc_phase6_multi.docx` — Phase 6 (performance)
- `veryBigDoc_phase9_table_cell.docx` — Phase 9.1 (table cell edit)
- `veryBigDoc_phase9_cell_prose.docx` — Phase 9.4 (cell prose edit)
- `veryBigDoc_phase10_probe.docx`, `veryBigDoc_phase10_hyperlink.docx`, `veryBigDoc_phase10_link_target.docx` — Phase 10 (cross-refs/hyperlinks)

# Appendix B — Verdict

**Engine is sales-demo-ready** for the operator's three named scenarios:
1. Proposal vs. counterparty-response diff (silent-change detection): **works**
2. PADU playbook redlining with on-disk and live-Word interop: **works** (flag the author-spoofing limitation in TECH-1)
3. Sanitization before send-back: **works**, with auditable reports

The technical findings (Part II) are not blockers — they are documentation/UX improvements that would tighten the product. Three of them (TECH-1, TECH-2, TECH-3) are worth fixing before the next demo. The rest are polish.

The domain visibility gaps (Part III) are not bugs — they are roadmap. They define where the tool's value proposition broadens from "great for NDAs" to "great for any contract." Closing them is what separates a useful Markdown-DOCX tool from a category-defining legal-document platform.
