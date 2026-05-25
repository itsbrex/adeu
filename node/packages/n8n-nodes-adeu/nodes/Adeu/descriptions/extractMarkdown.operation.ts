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
      "Name of the binary property on the incoming item that holds the .docx file. Must reference an existing binary attachment (string, e.g. 'data'). The file must be a valid .docx (not .doc, .pdf, or another format).",
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
      "Boolean. When true, projects the document as if all pending tracked changes were accepted (simulates Accept All). When false (default), all tracked changes are surfaced inline as CriticMarkup ({++ins++}, {--del--}, {>>comment<<}) so an AI can review and resolve them. Use false to review counterparty edits; use true to generate net-new redlines against a clean baseline.",
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
