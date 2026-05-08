# Adeu Performance Scaling Plan

## Background

The Adeu MCP server is a "Virtual DOM" bridge between LLMs and DOCX documents. It projects OOXML into a flat Markdown-like text representation, lets the LLM submit text-based edits, and translates those edits into native Word Tracked Changes.

The architecture works on small-to-medium documents (~50 pages) but breaks on large enterprise documents (1000+ pages, 9MB+, 40K+ paragraphs, 553K+ XML runs). The MCP server is **not long-lived** — it spins up per tool call and dies when the call returns. This rules out in-process caching.

## Constraints That Shape the Solution

1. **MCP payload ceiling: ~19,000 characters per response, including all metadata.** Larger payloads get silently chunked / offloaded by Claude Desktop, degrading agent behavior.
2. **Cold-start cost matters most.** Every tool call pays full parsing + projection cost. Hot-run improvements help nothing.
3. **Edits must work on any page.** The redlining engine must continue to work over the full document, not just the page being read.
4. **Legal-document use case requires editing safety.** The agent must know about defined terms, cross-references, and bookmarks before making edits, or it can silently break the document's structure.
5. **Per-tool-call timeout is 4 minutes.** But individual calls should ideally come in under 30 seconds for usable agent UX.

## Measured Baseline (on a representative 9MB / 1000+ page legal doc)

| Operation | Cold Time | Payload |
|---|---|---|
| Full parse only | ~1.5s | — |
| Body projection | ~20s | 4MB total |
| Appendix construction | ~8.5s | 437KB |
| `read_docx mode='full' page=1` | ~30s | 455KB (96% appendix) |
| `read_docx mode='outline'` | ~66s | 552KB (7066 nodes) |

Diagnosis: parsing is fine, projection is the dominant cost, and the appendix gets injected into every page making payloads protocol-violating. Outline mode duplicates projection work.

## What's NOT Worth Pursuing

These were considered and ruled out, in case the next reviewer revisits them:

- **Replacing python-docx with a faster XML library.** Parsing is only 1.5s of the 30s. Not the bottleneck.
- **Big-data libraries (pandas, polars, dask, ray).** Tree-shaped data, sequential offset dependencies, no rows to vectorize. Wrong tool category entirely.
- **In-process caching.** Server dies after each call. No state survives.
- **Multi-threading the projection.** GIL-bound CPU work, sequential offset dependency. Limited gain, real complexity.
- **Streaming `iterparse`.** Doesn't help when ~95% of cost is post-parse.

## The Plan: Five Steps

Each step is independently verifiable. Steps 1-3 are payload/protocol fixes (architectural); Steps 4-5 are performance fixes (algorithmic). They are ordered by leverage and risk.

---

### Step 1: Trim the Outline Output

**Problem:** `mode='outline'` returns 7066 nodes (552KB) on the test doc. Most are level-5 headings the agent doesn't need for navigation. Payload blows the 19K ceiling 29x over.

**Fix:** Add `outline_max_level` (default `2`) and `outline_verbose` (default `False`) parameters to `read_docx`. Filter at the rendering boundary, not at extraction (so extracted data stays complete; only the rendered output is trimmed).

**Files touched:**
- `src/adeu/outline.py` — `render_outline_tree` accepts `max_level` and `verbose`.
- `src/adeu/mcp_components/_response_builders.py` — `build_outline_response` accepts and threads the params, includes a "showing N of M, raise outline_max_level to see more" hint.
- `src/adeu/mcp_components/tools/document.py` — both win32 and non-win32 `read_docx` definitions get the new params.
- `src/adeu/mcp_components/tools/live_word.py` — `read_active_word_document` and its non-win32 stub get the new params.

**What it fixes:** Outline payload drops from ~552KB to ~2KB. Now usable on large docs. Performance unchanged (computation isn't optimized — only output is trimmed).

**Risk:** Very low. Pure presentation-layer change. Doesn't touch projection, mapper, or the redlining engine.

---

### Step 2: Split Appendix from Body Pages

**Problem:** The Structural Appendix (defined terms, anchors, diagnostics) is ~437KB on the test doc and gets glued onto every body page. Page 1 is 455KB, of which 437KB is appendix — 96% appendix overhead. Payload protocol-violating.

**Fix:** Stop attaching the appendix to body pages. Add a new `mode='appendix'` to `read_docx` that returns the appendix on demand, paginated using the same paginator. Body pages get a one-line footer pointing the agent at `mode='appendix'` so the agent knows the metadata exists and can fetch it before editing.

**Files touched:**
- `src/adeu/mcp_components/_response_builders.py` —
  - `build_paginated_response` paginates body only (passes empty string as appendix to `paginate()`); appends an `_build_appendix_pointer` footer.
  - New helper `_build_appendix_pointer(file_path, has_appendix)` returns the footer.
  - New function `build_appendix_response(text, page, file_path)` paginates the appendix as if it were body, with appendix-specific banner wording.
  - `build_outline_response` stops passing the appendix to `paginate()` (still calls `split_structural_appendix` to discard it cleanly).
  - Update module docstring to document the new channel contract.
- `src/adeu/mcp_components/tools/document.py` —
  - Import `build_appendix_response`.
  - `_read_docx_disk` dispatches `mode == "appendix"` to the new builder.
  - Both `read_docx` definitions update their `mode` Literal to `["full", "outline", "appendix"]`.
  - Update `READ_DOCX_TAIL` description to document the new mode AND emphasize "consult appendix before editing legal/technical documents."
- `src/adeu/mcp_components/tools/live_word.py` —
  - Import `build_appendix_response`.
  - Live Word `read_active_word_document` dispatches `mode == "appendix"` to the new builder.

**What it fixes:** Body pages drop from ~455KB to ~19K. Appendix becomes a separate, paginated, on-demand resource. System stops violating the payload ceiling on body and outline reads. Performance unchanged — the appendix is still computed unnecessarily for body and outline modes.

**Risk:** Low-to-medium. Protocol behavior change for agents. Existing prompts/skills that expect appendix on every page need to be updated to call `mode='appendix'` when needed. The footer pointer is the discoverability mechanism.

---

### Step 3: Make Appendix Computation Conditional

**Problem:** `_extract_text_from_doc` always calls `build_structural_appendix` (~8.5s). After Step 2, body and outline modes don't ship the appendix in their response, so this is pure waste — computing data we throw away.

**Fix:** Add `include_appendix: bool = True` parameter to `_extract_text_from_doc`. Default True for backward compatibility. Response dispatchers pass `include_appendix=(mode == "appendix")`.

**Files touched:**
- `src/adeu/ingest.py` — `_extract_text_from_doc` accepts `include_appendix`; skips `build_structural_appendix` call when False.
- `src/adeu/mcp_components/tools/document.py` — `_read_docx_disk` computes `needs_appendix = (mode == "appendix")` and passes it through.
- `src/adeu/mcp_components/tools/live_word.py` — `_read_active_word_document_core` accepts `include_appendix`, threads it to `_extract_text_from_doc`. `read_active_word_document` computes `needs_appendix` and passes it. Non-Windows stub updated to match new signature.

**What it fixes:** `mode='full'` drops from ~30s to ~22s. `mode='outline'` drops from ~66s to ~60s. (Outline savings smaller because it has separate duplication — see Step 4.) `mode='appendix'` unchanged at ~30s (this mode actually needs the appendix). Saves ~8.5s on every body and outline read.

**Risk:** Low. Pure work-elimination. The appendix data is unchanged when requested; just not computed when discarded.

---

### Step 4: Eliminate Outline's Duplicate Projection

**Problem:** `mode='outline'` is ~60s after Step 3. The body projection takes ~22s; the remaining ~38s is `extract_outline` calling `build_paragraph_text` per paragraph again (40K paragraphs) to extract heading text and compute offsets. This is full duplicate projection.

**Fix:** Add a side-channel to `_extract_text_from_doc` that records per-paragraph `(start_offset, length)` in the projected text during the existing walk. Cost is one dict insert per paragraph (~free). Outline uses the offset map to slice projected text instead of re-projecting.

**Mechanism:** New `return_paragraph_offsets: bool = False` param on `_extract_text_from_doc`. When True, returns `(text, offset_map)` tuple where `offset_map` is `Dict[id(paragraph._element), (start_offset, length)]`. Map is built inline during `_extract_blocks` and `extract_table` recursion — perfect-by-construction offsets, no second tree walk.

**Files touched:**
- `src/adeu/ingest.py` —
  - `_extract_text_from_doc` accepts `return_paragraph_offsets`, returns tuple when True. Manages cursor position across parts and the `\n\n` joins between them.
  - `_extract_blocks` accepts `offset_map` and `cursor` params. Records each paragraph's offset as it walks. Passes cursor through to recursive calls (footnote items, table cells).
  - `extract_table` accepts `offset_map` and `cursor` params. Computes per-cell cursor including row separators (`\n`), wrapper prefixes (`{++ `, `{-- `), and cell separators (` | `). Recurses into `_extract_blocks` for cell contents with correct cursor.
- `src/adeu/outline.py` —
  - `extract_outline` accepts `paragraph_offsets` param. When provided, dispatches to new `_extract_outline_fast` path. Legacy slow path retained as fallback.
  - New `_extract_outline_fast` walks the tree to identify headings (lxml structural traversal — fast) but reads heading text by slicing projected_body using the offset map. Also computes `has_table` and `footnote_ids` from the tree walk without re-projecting.
  - New `_heading_passes_quality_filter_fast` and `_heading_text_fast` — same logic as their legacy counterparts but slice the projected body instead of calling `build_paragraph_text`.
  - New `_collect_footnote_ids_fast` — walks owned items list (kind, item) tuples instead of `_BlockRecord` objects.
- `src/adeu/mcp_components/_response_builders.py` — `build_outline_response` accepts `paragraph_offsets` param, passes it to `extract_outline`.
- `src/adeu/mcp_components/tools/document.py` — `_read_docx_disk` requests offsets when `mode == "outline"`, unpacks the tuple from `_extract_text_from_doc`, passes offsets to `build_outline_response`.
- `src/adeu/mcp_components/tools/live_word.py` —
  - `_read_active_word_document_core` accepts `return_paragraph_offsets`. Returns 4-tuple when True (text, path, doc, offsets) vs. 3-tuple otherwise.
  - `read_active_word_document` requests offsets when `mode == "outline"`, branches on tuple arity, passes offsets to `build_outline_response`.
  - Non-Windows stub updated to match new signature.

**What it fixes:** `mode='outline'` drops from ~60s to ~22s — matches `mode='full'` cost. After Step 4, all three modes have similar cost shape, with differences explained only by what each genuinely needs to compute.

**Risk:** Medium. The offset map must align perfectly with what `paginate()` produces and what `build_paragraph_text` actually emits. Cursor math through tables (especially with tracked-row wrappers `{++ `/`{-- `) is the most error-prone part. Verification needed:
- Heading text matches legacy outline output (eyeball test).
- Page numbers match (within ±1 tolerance for offset edge cases).
- Verbose mode still shows style/has_table/footnote IDs correctly.
- Tables with tracked row insertions produce correct heading text for paragraphs inside affected rows.

The legacy slow path is retained intentionally as a safety fallback. After Step 4 is verified in production, that fallback can be deleted in future cleanup.

---

### Step 5: Optimize the Projection Hot Loop

**Problem:** After Steps 1-4, projection is ~20s and dominates every read. Hot loop at ~36 microseconds per run × 553K runs.

**Approach:** Profile first with cProfile (specifically wrapping `_extract_text_from_doc` call), then apply targeted optimizations to the actual hot functions revealed by the profile. Hypotheses to validate:
- `_get_style_cache` lookups happen per-run; should be cached per-paragraph.
- `build_paragraph_text` does unconditional `.copy()` on tracked-change state dicts even when no comments/redlines exist in the paragraph.
- `apply_formatting_to_segments` runs at full cost even when prefix/suffix are both empty.
- `get_run_text` walks all child elements looking for tabs/breaks even on plain text runs.

**Files likely to be touched:**
- `src/adeu/utils/docx.py` — hoist per-paragraph work out of run loops; short-circuit empty-format paths.
- `src/adeu/ingest.py` — short-circuit redline state machine when paragraph has no `<w:ins>` or `<w:del>` children.
- `src/adeu/redline/mapper.py` — **mirror every change made to `build_paragraph_text` in `_map_paragraph_content`**. This is the projection/mapper parity invariant — the mapper must produce identical projected text at identical offsets, or edits land at wrong positions.

**What it fixes:** Projection drops from ~20s to ~6-10s. After Step 5, full read cost is ~8-12s, outline is ~8-12s, appendix is ~16-20s (still dominated by appendix computation, which itself can be optimized — see "Future work" below).

**Risk:** Medium-to-high. The projection/mapper parity invariant is the most important contract in the system. Breaking it silently corrupts edits — the edit lands at the wrong character offset, splitting words or modifying unintended text. Profile-driven optimization with regression testing is required. Add a parity test: compare `_extract_text_from_doc(doc)` output against `DocumentMapper(doc).full_text` — they must be byte-identical.

---

## Future Work (Not in Scope for This Session)

If Steps 1-5 land cleanly and more performance is needed:

- **Sidecar SQLite cache.** Persist projected text + offset map + appendix to `~/.cache/adeu/{doc_hash}/` keyed by absolute path + mtime + size. Cold cost on cached docs drops to single-digit milliseconds. Premature before Step 5 — would lock in slow code.
- **Single-pass `extract_anchors`** in `domain.py`. Currently does two full document walks (one for bookmarks, one for cross-references). Easy ~2s win on appendix mode.
- **Page-scoped appendix.** Only emit appendix entries relevant to the current page (terms used on this page, anchors referenced from/to this page). Reduces appendix payload on body pages (if we re-add inline appendix for safety) without losing the editing-safety property. Significantly more complex than Step 2's on-demand model.
- **Outline pagination.** Currently outline returns one big response. If a doc has so many top-level headings that even L1-L2 exceeds 19K, the outline itself needs to paginate.

## Final Expected State

After all five steps land:

| Operation | Before | After | Payload |
|---|---|---|---|
| `mode='full' page=1` | ~30s, 455KB | **~8-12s, ~19K** | ✅ |
| `mode='outline'` | ~66s, 552KB | **~8-12s, ~2K** | ✅ |
| `mode='appendix' page=1` | (didn't exist) | **~16-20s, ~1.3K** | ✅ |

System becomes usable on 1000+ page documents. All modes fit within MCP payload ceiling. All modes complete well within tool-call timeout. Edits remain functional on any page (redlining engine untouched).