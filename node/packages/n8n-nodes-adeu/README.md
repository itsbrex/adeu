# n8n-nodes-adeu

[![npm version](https://img.shields.io/npm/v/n8n-nodes-adeu.svg)](https://www.npmjs.com/package/n8n-nodes-adeu)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An [n8n](https://n8n.io) community node for **[Adeu](https://adeu.ai)** — the Virtual DOM for Microsoft Word.

This node lets your n8n workflows apply AI-driven tracked changes, extract LLM-friendly Markdown, generate diffs, and sanitize `.docx` documents — all without leaving the n8n canvas.

It is a thin wrapper around the [`@adeu/core`](https://www.npmjs.com/package/@adeu/core) TypeScript engine, which executes entirely in-process. Your documents never leave the n8n runtime.

## Installation

Follow n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and install `n8n-nodes-adeu`.

## Operations

The node exposes one resource (**Document**) with four operations:

### Extract Markdown
Project a `.docx` into LLM-friendly CriticMarkup (with a Semantic Appendix of defined terms, cross-references, and likely typos).
- **Input**: `.docx` binary
- **Output**: JSON `{ markdown, fileName, cleanView }`
- Use `Clean View = true` to simulate "Accept All Changes" before extraction.

### Apply Edits
Apply a batch of `DocumentChange` operations as native Word tracked changes and comments.
- **Input**: `.docx` binary + a `changes` array (from upstream JSON or defined inline)
- **Output**: redlined `.docx` binary + JSON stats
- Supported change types: `modify`, `accept`, `reject`, `reply`, `insert_row`, `delete_row`

The typical pipeline is: **Read DOCX → LLM Node → Adeu (Apply Edits) → Send Email**, where the LLM outputs a JSON array of edits matching the `DocumentChange` schema from [`@adeu/core`](https://github.com/dealfluence/adeu/tree/main/node/packages/core).

### Generate Diff
Produce a sub-word level `@@ Word Patch @@` diff between two `.docx` documents.
- **Input**: two `.docx` binaries on the same item (defaults: `data` and `data2`)
- **Output**: JSON `{ diff, originalFileName, modifiedFileName }`

### Finalize Document
Strip metadata (author names, internal IDs, RSIDs, custom XML), optionally accept all tracked changes, and optionally lock the document read-only.
- **Input**: `.docx` binary
- **Output**: finalized `.docx` binary + a human-readable sanitization report

## Example Workflow

```
[ Read Binary File ]
        │
        ▼
[ AI Agent / OpenAI ]      ← outputs { changes: [...] }
        │
        ▼
[ Adeu — Apply Edits ]     ← reads changes from input JSON
        │
        ▼
[ Adeu — Finalize Document ]
        │
        ▼
[ Send Email (with attachment) ]
```

## Error Handling

When `@adeu/core` rejects an edit, this node surfaces a structured `NodeApiError` with both *what happened* and *how to fix it* — e.g.:
- "An edit could not be applied: target text not found." → verify exact punctuation/whitespace
- "An edit matched multiple locations in the document." → add surrounding context to `target_text`
- "The document could not be opened." → verify the binary is `.docx`, not `.doc`/`.pdf`

Enable n8n's **Continue On Fail** to keep batch workflows running through partial errors.

## License

MIT — see [LICENSE](../../../LICENSE).