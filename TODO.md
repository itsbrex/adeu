# Specification: Node.js Port Completion & Testing

## 1. Dual-MCP Parity Testing Setup

**The Problem:** MCP clients (like Claude Desktop) flatten all tools from all configured servers into a single array. If both the Python server and the Node server expose `read_docx`, a "Tool Name Collision" occurs, causing undefined behavior or LLM paralysis.

**The Solution:** We will introduce an environment variable `ADEU_TOOL_PREFIX` to the Node server. When running in "Parity Mode", the Node server will dynamically prefix its tools (e.g., `node_read_docx`, `node_process_document_batch`). This allows both servers to run simultaneously in Claude, enabling you to prompt: *"Run `read_docx` on this file, and then run `node_read_docx` on the same file and compare the markdown byte-for-byte."*

### Config to Inject (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "adeu-python": {
      "command": "uv",
      "args": ["run", "-m", "adeu.server"],
      "cwd": "C:/path/to/adeu/python"
    },
    "adeu-node": {
      "command": "node",
      "args": ["./desktop-extension/index.js"],
      "cwd": "C:/path/to/adeu",
      "env": {
        "ADEU_TOOL_PREFIX": "node_"
      }
    }
  }
}
```

## 2. Phase Execution Plan

### Phase 1: Structural Appendix (`domain.ts`)
We will port Python's `domain.py` to extract defined terms, cross-references, and typo diagnostics.
*   **Constraint:** Node cannot use Python's C++ backed `rapidfuzz`. We will implement a fast, pure-JavaScript `levenshteinDistance` function (optimized with a bounded 1D/2D array since we only care about `score_cutoff <= 2`).
*   **Implementation:**
    *   Write DOM traversal for `w:bookmarkStart`, `w:fldSimple`, and `w:instrText` inside `@adeu/core/src/domain.ts`.
    *   Implement regex matching for acronyms and quoted definitions.
    *   Format and append the `<!-- READONLY_BOUNDARY_START -->` block during ingestion.
    *   Update `ingest.test.ts` to verify the appendix matches Python's output.

### Phase 2: Diff Tool (`diff_docx_files`)
We will implement the missing MCP tool in the Node server.
*   **Implementation:**
    *   The hard part (`generate_edits_from_text` and `diff-match-patch`) is already ported in `@adeu/core/src/diff.ts`.
    *   Port Python's `_create_diff_output` (the Unified Diff string formatter) into `@adeu/core/src/diff.ts`.
    *   Register the `diff_docx_files` tool in `@adeu/mcp-server/src/index.ts`.

### Phase 3: Document Finalization (`sanitize.ts` & `transforms.ts`)
We will port the metadata scrubbing and `accept_all_changes` reporting logic.
*   **Implementation:**
    *   Create `@adeu/core/src/sanitize/transforms.ts` to implement surgical XML node deletion:
        *   `strip_rsid` / `strip_para_ids` (w14/w15/w16cid attributes)
        *   `strip_custom_xml` (deep package ejection via `DocxPackage` relationships)
        *   `scrub_doc_properties` (modifying `docProps/app.xml` and `core.xml` via JSZip)
    *   Port `report.py` logic to generate the `SanitizeReport`.
    *   Register `finalize_document` (or `sanitize_docx`) in the Node MCP server.

---

### Executing the Setup (Phase 0)

To get our Dual-MCP setup ready, I will patch the Node MCP Server to support the dynamic prefixing right now. 

// FILE: node/packages/mcp-server/src/index.ts
```typescript
@@ ... @@
-const READ_DOCX_TAIL = "Modes:\n- 'full' (default): paginated body content. Use page=N to navigate.\n- 'outline': heading map only — start here for large docs to plan targeted reads. Defaults to L1-L2 headings; pass outline_max_level=3-6 to see deeper structure.\n- 'appendix': defined terms, anchors, and cross-reference targets. Consult before editing legal/technical docs to avoid breaking references.";
+const READ_DOCX_TAIL = "Modes:\n- 'full' (default): paginated body content. Use page=N to navigate.\n- 'outline': heading map only — start here for large docs to plan targeted reads. Defaults to L1-L2 headings; pass outline_max_level=3-6 to see deeper structure.\n- 'appendix': defined terms, anchors, and cross-reference targets. Consult before editing legal/technical docs to avoid breaking references.";
 
 const PROCESS_BATCH_COMMON_DESC = "Applies a batch of edits and review actions to a DOCX.\n\nAll changes evaluate against the ORIGINAL document state — do not chain dependent edits within one batch (e.g. rename X to Y, then modify Y). Apply the rename first, then send a second batch.\n\n";
@@ ... @@
+const TOOL_PREFIX = process.env.ADEU_TOOL_PREFIX || '';
+
 // --- Server Setup ---
 const server = new Server(
@@ ... @@
 server.setRequestHandler(ListToolsRequestSchema, async () => {
   return {
     tools: [
       {
-        name: 'read_docx',
+        name: `${TOOL_PREFIX}read_docx`,
         description: READ_DOCX_COMMON_DESC + READ_DOCX_TAIL,
         inputSchema: {
@@ ... @@
       },
       {
-        name: 'process_document_batch',
+        name: `${TOOL_PREFIX}process_document_batch`,
         description: PROCESS_BATCH_COMMON_DESC + PROCESS_BATCH_OPERATIONS_DESC,
         inputSchema: {
@@ ... @@
       },
       {
-        name: 'accept_all_changes',
+        name: `${TOOL_PREFIX}accept_all_changes`,
         description: "Accepts all tracked changes and removes all comments in a single operation, producing a finalized clean document. Use this when a document review is entirely complete and you want to clear all redlines.",
         inputSchema: {
@@ ... @@
 // --- Tool Execution ---
 server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
-  const { name, arguments: args } = request.params;
+  let { name, arguments: args } = request.params;
+  
+  // Strip prefix for internal routing if one exists
+  if (TOOL_PREFIX && name.startsWith(TOOL_PREFIX)) {
+    name = name.substring(TOOL_PREFIX.length);
+  }
 
   try {
     if (name === 'read_docx') {
```

If you agree with this plan, let's start with **Phase 1: Structural Appendix (`domain.ts`)**. I will provide the full pure-TS implementations for extracting bookmarks, refs, definitions, and the Levenshtein typo scanner. 

Shall we proceed to Phase 1?
[AWAITING USER RESPONSE]