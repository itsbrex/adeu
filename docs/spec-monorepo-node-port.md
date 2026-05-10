# Specification: Polyglot Monorepo & Native Node.js Port

## 1. Executive Summary

**The Problem:** Adeu is currently a Python-centric project. However, the Model Context Protocol (MCP) ecosystem—specifically Anthropic's Claude Desktop (`.mcpb` bundles)—heavily favors native Node.js execution. Currently, installing Adeu into Claude Desktop requires bootstrapping a Python environment via `uvx`, which creates friction and cross-platform installation vulnerabilities.

**The Solution:** We are transitioning the Adeu repository into a **Polyglot Monorepo**. 
1. We will retain and isolate the robust Python SDK (`adeu-py`).
2. We will build a native TypeScript/Node.js redlining engine (`@adeu/core`) and an accompanying MCP server (`@adeu/mcp-server`).
3. Keeping everything in one repository consolidates community reputation (GitHub stars), issue tracking, and documentation.

## 2. Monorepo Architecture

To prevent toolchain collisions (e.g., `npm install` conflicting with `uv sync`), the repository will use a top-level, language-based isolation strategy.

```text
adeu/
├── docs/                 # Shared specifications and architecture docs
├── shared/
│   └── fixtures/         # Golden .docx files used by BOTH Python and Node test suites
├── python/               # The existing Python ecosystem
│   ├── src/adeu/         
│   ├── tests/
│   └── pyproject.toml    # uv workspace definition
├── node/                 # The new TypeScript ecosystem
│   ├── packages/
│   │   ├── core/         # Core redlining engine (Pure TS)
│   │   └── mcp-server/   # Claude Desktop MCP Server
│   └── package.json      # npm workspace root
└── .github/workflows/    # Matrix CI/CD
```

### 2.1 The "Shared Fixtures" Contract
Because Adeu operates as a surgical XML patcher, the Node.js engine and the Python engine must achieve **100% output parity**. Both the `pytest` and `vitest` test runners will target the exact same `.docx` files in `shared/fixtures/`. If the Node engine modifies a document, its output XML must match the Python engine's output mathematically.

## 3. Node.js Technical Stack & Constraints

### 3.1 The C++ / WASM Constraint
Claude Desktop executes `.mcpb` bundles inside an embedded, sandboxed Node environment. **We cannot use native C++ bindings** (like `node-gyp`). Any dependency we use must be 100% Pure JavaScript or pre-compiled WebAssembly, otherwise the installation will fail on user machines due to architecture mismatches.

### 3.2 Chosen Libraries (`@adeu/core`)
The Python engine relies on `python-docx` for OOP abstraction and `lxml` for blazing-fast, whitespace-preserving DOM manipulation. The Node engine will implement a minimal subset of this using pure JS:

*   **Archive Handling:** `jszip` (Pure JS, industry standard for unpacking/repacking `.docx` buffers).
*   **XML DOM Manipulation:** `@xmldom/xmldom` (Pure JS W3C DOM implementation. Crucially, it preserves raw XML whitespace and namespaces seamlessly, which is required to prevent massive, noisy git-style diffs when saving).
*   **XPath Querying:** `xpath` (Pure JS, allows us to replicate logic like `doc.element.xpath("//w:ins")`).
*   **Diffing Engine:** `diff-match-patch` (Pure JS, mathematically identical to the Python library currently in use).

### 3.3 Excluded Technologies
*   **`office.js`**: Rejected. `office.js` only functions inside the Microsoft Word UI browser panel. It cannot read or modify `.docx` files headlessly on a local filesystem, which is required for an MCP background server.
*   **`cheerio` / SAX Parsers**: Rejected. While fast, they are designed for HTML scraping. They lack the rigorous namespace management and sibling-node mutation capabilities required for strict OOXML compliance.

## 4. Execution Roadmap

### Phase 1: Structural Migration (Git Preservation) - **[COMPLETED]**
*   [x] Created `python/`, `node/`, and `shared/` directories.
*   [x] Used `git mv` to shift the existing Python codebase and configs into `python/` to preserve `git blame` history.
*   [x] Moved `tests/fixtures/` to `shared/fixtures/`.
*   [x] Updated CI/CD workflows using explicit `working-directory: ./python` settings to resolve multi-line shell state failures.

### Phase 2: Node Workspace Scaffolding (Next Steps)
*   [ ] Scaffold `node/packages/core/package.json` to utilize the existing root `node/package.json` npm workspace.
*   [ ] Setup `@adeu/core` with `typescript`, `tsup` (for dual ESM/CJS builds), and `vitest`.
*   [ ] Configure `vitest` path aliases to seamlessly resolve `../../../shared/fixtures/` across the monorepo boundary.
*   [ ] Update `.github/workflows/ci.yml` to execute the Node matrix (`npm install`, `npm test`) alongside Python.

### Phase 3: Porting `@adeu/core` (The Hard Part)
*   **Step 1 (ZIP/XML Bridge):** Build a wrapper around `jszip` and `xmldom` that exposes a `Document` object mimicking the `python-docx` API surface we actually use (paragraphs, runs, tables, saving).
*   **Step 2 (Ingestion):** Port `ingest.py` and `utils/docx.py`. Write tests verifying that given a shared fixture, the TS engine projects the exact same Markdown CriticMarkup as Python.
*   **Step 3 (Diffing):** Port `diff.py` (Word-level tokenization and `diff-match-patch`).
*   **Step 4 (Reconciliation):** Port `mapper.py` and `engine.py`. This is the core logic that parses edits, maps them to XML runs, and safely injects `<w:ins>` and `<w:del>`.

### Phase 4: Porting `@adeu/mcp-server`
*   Create the Node MCP server using `@modelcontextprotocol/sdk`.
*   Implement the `read_docx`, `process_document_batch`, and `validate_documents` tools utilizing the `@adeu/core` engine.
*   Replace the current `desktop-extension` bootstrapper with a native `.mcpb` build configuration.
