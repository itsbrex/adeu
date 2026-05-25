import type { INodeProperties } from "n8n-workflow";

import { extractMarkdownDescription } from "./extractMarkdown.operation";
import { applyEditsDescription } from "./applyEdits.operation";
import { generateDiffDescription } from "./generateDiff.operation";
import { finalizeDocumentDescription } from "./finalizeDocument.operation";

export const documentDescription: INodeProperties[] = [
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: {
      show: {
        resource: ["document"],
      },
    },
    options: [
      {
        name: "Apply Edits",
        value: "applyEdits",
        action: "Apply a batch of tracked changes to the document",
        description:
          "Apply a JSON array of DocumentChange objects (modify, accept, reject, reply, insert_row, delete_row) as native Word tracked changes and comments. The whole batch is pre-validated atomically: if any single edit is invalid, the entire batch is rejected and the document is left untouched.",
      },
      {
        name: "Extract Markdown",
        value: "extractMarkdown",
        action: "Extract a Markdown representation of the document",
        description:
          "Project the .docx into LLM-friendly Markdown with CriticMarkup ({++ins++}, {--del--}, {>>comment<<}) plus a Semantic Appendix listing defined terms, cross-references, and potential typos. Each tracked change is tagged with a stable id (Chg:N, Com:N) for use in Apply Edits.",
      },
      {
        name: "Finalize Document",
        value: "finalizeDocument",
        action: "Sanitize metadata and lock the document for distribution",
        description:
          "Strip author names, internal IDs, RSIDs, and proof errors; optionally auto-accept all pending tracked changes; optionally lock the document read-only. Use before sending to counterparties or signers.",
      },
      {
        name: "Generate Diff",
        value: "generateDiff",
        action: "Generate a Word Patch diff between two documents",
        description:
          "Produce a sub-word level @@ Word Patch @@ diff between two .docx files. Reads the document text via the same Markdown projection used by Extract Markdown, so the diff respects CriticMarkup and Clean View settings.",
      },
    ],
    default: "extractMarkdown",
  },
  ...extractMarkdownDescription,
  ...applyEditsDescription,
  ...generateDiffDescription,
  ...finalizeDocumentDescription,
];
