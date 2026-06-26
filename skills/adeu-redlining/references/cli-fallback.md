# Adeu CLI Reference (Fallback Path)

When the Adeu MCP tools are unavailable, drive Adeu via the `uvx adeu` CLI through Bash.

**The CLI is Python-only.** Adeu does not ship a Node CLI — only a Node MCP server (`@adeu/mcp-server`). If the user is on a Node-only setup and the MCP server isn't running, the right move is usually to suggest they install the MCP server (`npx -y @adeu/mcp-server`) rather than introduce a Python toolchain just for one-off CLI use. Only fall through to `uvx adeu` when the MCP path genuinely isn't an option.

If `uvx` is not available, install it once: `pip install uv` (or see https://docs.astral.sh/uv/).

## Subcommands

### `adeu extract` — read a document

```bash
uvx adeu extract contract.docx -o contract.md
# Clean view (accepted state):
uvx adeu extract contract.docx --clean -o accepted.md
```

Output is Markdown with CriticMarkup for tracked changes and comments. The same semantic appendix (defined terms, cross-refs, bookmarks) appears at the bottom.

### `adeu diff` — compare two versions

```bash
uvx adeu diff v1.docx v2.docx
```

Returns Adeu's `@@ Word Patch @@` sub-word diff. Not a unified diff.

### `adeu apply` — apply edits as tracked changes

```bash
uvx adeu apply contract.docx edits.json --author "Review Bot" -o contract_redlined.docx
```

The `edits.json` file is a JSON array. Each entry has a `type` discriminator matching `process_document_batch` (see `references/mcp-tools.md` for the full shape):

```json
[
  {
    "type": "modify",
    "target_text": "State of New York",
    "new_text": "State of Delaware",
    "comment": "Standardizing governing law.",
    "match_mode": "strict"
  },
  {
    "type": "accept",
    "target_id": "Chg:7"
  },
  {
    "type": "reply",
    "target_id": "Com:3",
    "text": "Agreed — updated above."
  }
]
```

`accept` / `reject` / `reply` `target_id`s must come from an `adeu extract` run done *immediately before* generating `edits.json`. They are session-bound and shift every time the document state changes.

### `adeu sanitize` — strip metadata, optionally keep markup

```bash
# Full scrub:
uvx adeu sanitize redline.docx -o clean.docx --author "My Firm" --report

# Keep redline markup but redact author metadata:
uvx adeu sanitize redline.docx -o clean.docx --keep-markup --author "My Firm" --report
```

Use `--report` to print a sanitization report — useful for verifying what was removed.

### `adeu accept-all` — accept every change and drop every comment

```bash
uvx adeu accept-all redline.docx -o final.docx
```

## Workflow on the CLI path

1. `uvx adeu extract <doc> -o doc.md` — read it.
2. Construct `edits.json` based on what the user asked for.
3. `uvx adeu apply <doc> edits.json --author "<name>" -o <out>.docx`
4. `uvx adeu extract <out>.docx --clean -o verify.md` — verify by reading the clean view.

For ID-based operations (`accept`, `reject`, `reply`), step 1 and step 2 must be back-to-back. Do not reuse IDs across multiple `apply` runs.

## CLI vs MCP differences worth knowing

- **The CLI is Python-only.** Node users don't have a CLI equivalent — they should run the Node MCP server (`@adeu/mcp-server`) instead.
- The CLI does not expose Live MS Word (Windows COM) integration. That is MCP-only on the Python server.
- The CLI does not support a `dry_run` flag. To preview, apply to a throwaway output path and inspect with `adeu extract --clean`.
- Outline mode (`mode="outline"` on MCP) is not directly exposed as a CLI flag; use `adeu extract` and read the heading structure from the Markdown.