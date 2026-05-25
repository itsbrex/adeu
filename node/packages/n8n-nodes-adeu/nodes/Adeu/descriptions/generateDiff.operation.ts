import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from "n8n-workflow";
import { extractTextFromBuffer, create_word_patch_diff } from "@adeu/core";

import { getDocxBuffer } from "../GenericFunctions";

export const generateDiffDescription: INodeProperties[] = [
  {
    displayName: "Original Binary Property",
    name: "originalBinaryPropertyName",
    type: "string",
    default: "data",
    required: true,
    placeholder: "e.g. data",
    description:
      "Name of the binary property on the incoming item holding the original (baseline) .docx file (string, e.g. 'data'). Both files must be on the same input item.",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["generateDiff"],
      },
    },
  },
  {
    displayName: "Modified Binary Property",
    name: "modifiedBinaryPropertyName",
    type: "string",
    default: "data2",
    required: true,
    placeholder: "e.g. data2",
    description:
      "Name of the binary property on the incoming item holding the modified (compared-to) .docx file (string, e.g. 'data2'). Must be different from the original binary property name.",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["generateDiff"],
      },
    },
  },
  {
    displayName: "Clean View",
    name: "cleanView",
    type: "boolean",
    default: true,
    description:
      "Boolean. When true (default, recommended), compares the Accept All clean view of both documents — diffs reflect the final content as if all tracked changes were accepted. When false, diffs the raw CriticMarkup-projected text including pending change markers — useful for auditing tracked-change differences themselves.",
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["generateDiff"],
      },
    },
  },
];

export async function executeGenerateDiff(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const originalBinaryPropertyName = this.getNodeParameter(
    "originalBinaryPropertyName",
    itemIndex,
  ) as string;
  const modifiedBinaryPropertyName = this.getNodeParameter(
    "modifiedBinaryPropertyName",
    itemIndex,
  ) as string;
  const cleanView = this.getNodeParameter("cleanView", itemIndex) as boolean;

  const { buffer: originalBuffer, fileName: originalName } =
    await getDocxBuffer.call(this, itemIndex, originalBinaryPropertyName);
  const { buffer: modifiedBuffer, fileName: modifiedName } =
    await getDocxBuffer.call(this, itemIndex, modifiedBinaryPropertyName);

  const originalText = await extractTextFromBuffer(originalBuffer, cleanView);
  const modifiedText = await extractTextFromBuffer(modifiedBuffer, cleanView);

  const diff = create_word_patch_diff(
    originalText,
    modifiedText,
    originalName,
    modifiedName,
  );

  return [
    {
      json: {
        originalFileName: originalName,
        modifiedFileName: modifiedName,
        cleanView,
        diff,
      },
      pairedItem: { item: itemIndex },
    },
  ];
}
