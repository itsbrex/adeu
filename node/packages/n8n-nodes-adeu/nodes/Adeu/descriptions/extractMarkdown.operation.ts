import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from "n8n-workflow";
import { extractTextFromBuffer } from "@adeu/core";

import { getDocxBuffer } from "../GenericFunctions";

export const extractMarkdownDescription: INodeProperties[] = [
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
        operation: ["extractMarkdown"],
      },
    },
  },
  {
    displayName: "Clean View",
    name: "cleanView",
    type: "boolean",
    default: false,
    description:
      'Whether to project the document as if all tracked changes were accepted (simulates the "Accept All" state)',
    displayOptions: {
      show: {
        resource: ["document"],
        operation: ["extractMarkdown"],
      },
    },
  },
];

export async function executeExtractMarkdown(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const binaryPropertyName = this.getNodeParameter(
    "binaryPropertyName",
    itemIndex,
  ) as string;
  const cleanView = this.getNodeParameter("cleanView", itemIndex) as boolean;

  const { buffer, fileName } = await getDocxBuffer.call(
    this,
    itemIndex,
    binaryPropertyName,
  );
  const markdown = await extractTextFromBuffer(buffer, cleanView);

  return [
    {
      json: {
        fileName,
        cleanView,
        markdown,
      },
      pairedItem: { item: itemIndex },
    },
  ];
}
