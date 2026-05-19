// FILE: node/packages/n8n-nodes-adeu/nodes/Adeu/GenericFunctions.ts
import type { IExecuteFunctions, JsonObject } from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Resolves a dot-notation JSON path (e.g., "body.data.changes") safely.
 */
export function getNestedProperty(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return path.split(".").reduce((acc, part) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj as unknown);
}

/**
 * Reads a binary property from the current item and returns it as a Node Buffer
 * suitable for `DocumentObject.load(...)`. Throws a user-friendly NodeOperationError
 * if the property is missing.
 */
export async function getDocxBuffer(
  this: IExecuteFunctions,
  itemIndex: number,
  binaryPropertyName: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const item = this.getInputData()[itemIndex];

  if (!item.binary || !item.binary[binaryPropertyName]) {
    throw new NodeOperationError(
      this.getNode(),
      `No binary data found on property "${binaryPropertyName}"`,
      {
        description:
          "Verify that the upstream node produced binary data and that the property name matches.",
        itemIndex,
      },
    );
  }

  const binary = item.binary[binaryPropertyName];
  const buffer = await this.helpers.getBinaryDataBuffer(
    itemIndex,
    binaryPropertyName,
  );
  const fileName = binary.fileName ?? "document.docx";

  return { buffer, fileName };
}

/**
 * Builds a default output filename from an input filename and a suffix.
 *
 *   buildOutputFileName("contract.docx", "redlined") -> "contract_redlined.docx"
 *   buildOutputFileName("contract", "finalized")     -> "contract_finalized.docx"
 */
export function buildOutputFileName(
  inputFileName: string,
  suffix: string,
): string {
  const lastDot = inputFileName.lastIndexOf(".");
  const base =
    lastDot === -1 ? inputFileName : inputFileName.substring(0, lastDot);
  return `${base}_${suffix}.docx`;
}

/**
 * Parses a JSON-text parameter into an object/array. Surfaces a clear, actionable
 * error when the JSON is malformed so the user knows exactly what to fix.
 */
export function parseJsonParameter<T>(
  this: IExecuteFunctions,
  raw: unknown,
  itemIndex: number,
  parameterName: string,
): T {
  if (raw === undefined || raw === null || raw === "") {
    throw new NodeOperationError(
      this.getNode(),
      `Parameter "${parameterName}" is empty`,
      {
        description: `Provide a JSON value for "${parameterName}".`,
        itemIndex,
      },
    );
  }

  if (typeof raw === "object") {
    return raw as T;
  }

  try {
    return JSON.parse(raw as string) as T;
  } catch (error) {
    throw new NodeOperationError(
      this.getNode(),
      `Parameter "${parameterName}" is not valid JSON`,
      {
        description: (error as Error).message,
        itemIndex,
      },
    );
  }
}

/**
 * Translates errors thrown by `@adeu/core` (notably `BatchValidationError`)
 * into n8n's `NodeApiError` with actionable "what happened / how to solve it"
 * guidance per the n8n Developer Playbook.
 */
export function mapAdeuErrorToNodeApiError(
  this: IExecuteFunctions,
  error: Error,
): NodeApiError {
  const message = error.message ?? "Unknown error";
  const errorName = error.name ?? "";

  // BatchValidationError ships a `.errors` array of human-readable messages.
  // We use it to pick a focused message + description without dumping the
  // entire stack at the user.
  const errors = (error as unknown as { errors?: string[] }).errors;
  const joined = Array.isArray(errors) ? errors.join("\n") : message;
  const lower = joined.toLowerCase();

  if (errorName === "BatchValidationError") {
    if (lower.includes("target text not found")) {
      return new NodeApiError(
        this.getNode(),
        { message: joined } as JsonObject,
        {
          message: "An edit could not be applied: target text not found.",
          description:
            "Verify the exact `target_text` string — including punctuation and whitespace — against the document. Use the Extract Markdown operation to inspect what the engine sees.",
        },
      );
    }
    if (lower.includes("ambiguous match")) {
      return new NodeApiError(
        this.getNode(),
        { message: joined } as JsonObject,
        {
          message: "An edit matched multiple locations in the document.",
          description:
            "Provide more surrounding context in `target_text` to uniquely identify the location.",
        },
      );
    }
    if (lower.includes("read-only") || lower.includes("readonly")) {
      return new NodeApiError(
        this.getNode(),
        { message: joined } as JsonObject,
        {
          message: "An edit targeted a read-only structural element.",
          description:
            "Cross-references, internal anchors, hyperlinks, and the Structural Appendix cannot be modified via text replacement. Restrict edits to the document body.",
        },
      );
    }
    if (lower.includes("another author") || lower.includes("nested")) {
      return new NodeApiError(
        this.getNode(),
        { message: joined } as JsonObject,
        {
          message:
            "An edit overlaps with a pending tracked change by another author.",
          description:
            "Accept or reject the conflicting change first, or scope your edit outside of it.",
        },
      );
    }
    return new NodeApiError(this.getNode(), { message: joined } as JsonObject, {
      message: "Batch validation failed.",
      description: joined,
    });
  }

  if (
    lower.includes("invalid docx") ||
    lower.includes("missing word/document.xml")
  ) {
    return new NodeApiError(this.getNode(), { message } as JsonObject, {
      message: "The document could not be opened.",
      description:
        "Verify the input binary is a valid .docx file (not .doc, .pdf, or another format).",
    });
  }

  return new NodeApiError(this.getNode(), { message } as JsonObject, {
    message: "Adeu engine error.",
    description: message,
  });
}
