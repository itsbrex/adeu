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
      "Name of the binary property on the incoming item that holds the original .docx file",
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
      "Name of the binary property on the incoming item that holds the modified .docx file",
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
      'Whether to compare the "Accept All" clean view of both documents (recommended). Disable to diff raw CriticMarkup-projected text.',
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
