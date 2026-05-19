// FILE: node/packages/n8n-nodes-adeu/nodes/Adeu/descriptions/applyEdits.operation.ts
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from "n8n-workflow";
import { DocumentObject, RedlineEngine } from "@adeu/core";

import {
  DOCX_MIME_TYPE,
  buildOutputFileName,
  getDocxBuffer,
  getNestedProperty,
  parseJsonParameter,
} from "../GenericFunctions";

export const applyEditsDescription: INodeProperties[] = [
  {
    displayName: "Input Binary Property",
    name: "binaryPropertyName",
    type: "string",
    default: "data",
    required: true,
    placeholder: "e.g. data",
    description:
      "Name of the binary property on the incoming item that holds the .docx file",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
      },
    },
  },
  {
    displayName: "Output Binary Property",
    name: "outputBinaryPropertyName",
    type: "string",
    default: "data",
    required: true,
    placeholder: "e.g. data",
    description:
      "Name of the binary property on the outgoing item that will hold the redlined .docx file",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
      },
    },
  },
  {
    displayName: "Author",
    name: "author",
    type: "string",
    default: "Adeu AI",
    placeholder: "e.g. AI Reviewer",
    description:
      "Author name attached to all tracked changes and comments produced by this operation",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
      },
    },
  },
  {
    displayName: "Edits Source",
    name: "editsSource",
    type: "options",
    noDataExpression: true,
    default: "fromInputJson",
    description: "Where to read the list of changes from",
    options: [
      {
        name: "From Input JSON",
        value: "fromInputJson",
        description: "Read the changes array from the incoming item JSON",
      },
      {
        name: "Define Below",
        value: "defineBelow",
        description: "Provide a JSON literal directly in this node",
      },
    ],
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
      },
    },
  },
  {
    displayName: "JSON Path on Input Item",
    name: "editsJsonPath",
    type: "string",
    default: "changes",
    required: true,
    placeholder: "e.g. data.changes",
    description:
      "Property path (dot-notation supported) on the input item JSON whose value is the array of DocumentChange objects",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
        editsSource: ["fromInputJson"],
      },
    },
  },
  {
    displayName: "Changes (JSON)",
    name: "editsJson",
    type: "json",
    default:
      '[\n  {\n    "type": "modify",\n    "target_text": "State of New York",\n    "new_text": "State of Delaware",\n    "comment": "Standardizing governing law."\n  }\n]',
    required: true,
    description:
      "Array of DocumentChange objects. Supported types: modify, accept, reject, reply, insert_row, delete_row.",
    typeOptions: {
      rows: 10,
    },
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["applyEdits"],
        editsSource: ["defineBelow"],
      },
    },
  },
];

export async function executeApplyEdits(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const inputBinaryPropertyName = this.getNodeParameter(
    "binaryPropertyName",
    itemIndex,
  ) as string;
  const outputBinaryPropertyName = this.getNodeParameter(
    "outputBinaryPropertyName",
    itemIndex,
  ) as string;
  const author = this.getNodeParameter("author", itemIndex) as string;
  const editsSource = this.getNodeParameter("editsSource", itemIndex) as string;

  // Resolve the changes array
  let changes: unknown;
  if (editsSource === "fromInputJson") {
    const jsonPath = this.getNodeParameter(
      "editsJsonPath",
      itemIndex,
    ) as string;
    const inputJson = this.getInputData()[itemIndex].json;
    changes = getNestedProperty(inputJson as Record<string, unknown>, jsonPath);
    if (changes === undefined) {
      // Surface a clear error rather than silently passing undefined to the engine
      throw new Error(
        `No property "${jsonPath}" found on the input item JSON. Verify the upstream node produced it, or switch "Edits Source" to "Define Below".`,
      );
    }
  } else {
    const raw = this.getNodeParameter("editsJson", itemIndex);
    changes = parseJsonParameter.call(this, raw, itemIndex, "Changes (JSON)");
  }

  if (!Array.isArray(changes)) {
    throw new Error("Changes must be an array of DocumentChange objects.");
  }

  const { buffer, fileName } = await getDocxBuffer.call(
    this,
    itemIndex,
    inputBinaryPropertyName,
  );

  const doc = await DocumentObject.load(buffer);
  const engine = new RedlineEngine(doc, author);
  const stats = engine.process_batch(
    changes as Parameters<RedlineEngine["process_batch"]>[0],
  );

  const outBuffer = await doc.save();
  const outName = buildOutputFileName(fileName, "redlined");

  const binary = await this.helpers.prepareBinaryData(
    outBuffer,
    outName,
    DOCX_MIME_TYPE,
  );

  // Preserve other binaries the upstream item carried (e.g. sibling attachments)
  const incomingBinary = this.getInputData()[itemIndex].binary ?? {};

  return [
    {
      json: {
        fileName: outName,
        author,
        stats,
      },
      binary: {
        ...incomingBinary,
        [outputBinaryPropertyName]: binary,
      },
      pairedItem: { item: itemIndex },
    },
  ];
}
