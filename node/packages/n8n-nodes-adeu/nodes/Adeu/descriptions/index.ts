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
        name: "Extract Markdown",
        value: "extractMarkdown",
        action: "Extract a Markdown representation of the document",
        description:
          "Project the .docx into LLM-friendly CriticMarkup with a Semantic Appendix",
      },
      {
        name: "Apply Edits",
        value: "applyEdits",
        action: "Apply a batch of tracked changes to the document",
        description:
          "Apply ModifyText, AcceptChange, RejectChange, ReplyComment, InsertTableRow, and DeleteTableRow operations",
      },
      {
        name: "Generate Diff",
        value: "generateDiff",
        action: "Generate a Word Patch diff between two documents",
        description:
          "Produce a sub-word level @@ Word Patch @@ diff between two .docx documents",
      },
      {
        name: "Finalize Document",
        value: "finalizeDocument",
        action: "Sanitize metadata and lock the document for distribution",
        description:
          "Strip author names, internal IDs, and pending markup, then optionally lock the document read-only",
      },
    ],
    default: "extractMarkdown",
  },
  ...extractMarkdownDescription,
  ...applyEditsDescription,
  ...generateDiffDescription,
  ...finalizeDocumentDescription,
];
