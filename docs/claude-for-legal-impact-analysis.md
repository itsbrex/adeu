# Architectural Impacts of Anthropic's `claude-for-legal` on Adeu

## Executive Summary
Anthropic's `claude-for-legal` repository provides a reference implementation of advanced, agentic legal workflows (M&A diligence, commercial contract negotiation, privacy assessments). Rather than containing DOCX manipulation code, it contains the **system prompts and behavioral constraints** of the agents that will *consume* the Adeu MCP. 

Analyzing these agents reveals exactly how enterprise LLMs are expected to interact with Word documents. Overall, Adeu's architecture (Virtual DOM, CriticMarkup, `ModifyText`) is highly validated by these prompts, but specific API friction points exist around how agents handle uncertainty and net-new drafting.

---

## 1. Validation of the "Surgical Redline" Architecture

**The Legal Requirement:**
Throughout the `claude-for-legal` repository (e.g., `dpa-review/SKILL.md`), agents are strictly instructed on redline granularity:
> *"Edit at the smallest possible granularity. A redline is a negotiation artifact, not a rewrite... Surgical redlines — strike a word, insert a phrase, restructure a subclause..."*

**Adeu's Alignment: Excellent**
Adeu's core design—forcing the LLM to use search-and-replace (`ModifyText`) rather than rewriting whole paragraphs or documents—is perfectly aligned with this requirement. Because Adeu handles the `trim_common_context` logic under the hood and executes at the XML run-level, it allows the LLM to safely execute these "surgical strikes" without destroying surrounding OOXML structures (like gridspans or complex styles).

---

## 2. The API Friction Point: The "Review & Flag" Paradigm

**The Legal Requirement:**
Legal agents are explicitly forbidden from silently making subjective legal calls. They are instructed to "prefer the recoverable error" by leaving flags for a human attorney.
> *"When a skill... faces a subjective legal judgment... flag the specific line with `[review]` inline and note the uncertainty there... The `[review]` flag IS the mechanism."* (Shared Guardrails, `CLAUDE.md`)

**Adeu's Current Friction: High**
To leave a comment using Adeu's current API (`models.py`), an LLM must use `ModifyText`. It must supply the `target_text`, perfectly duplicate that string into `new_text`, and append the `comment`. 
*   **Token Waste:** If an agent wants to flag a 300-word indemnity clause, it must burn 300 output tokens rewriting the identical clause into `new_text`.
*   **Latency & Error Risk:** Emitting large strings increases response time and introduces the risk of minor hallucinated typos. If the LLM alters a single comma in `new_text`, Adeu's engine will natively (and correctly) treat it as a deletion/insertion redline rather than a pure comment, polluting the document's negotiation timeline.

**Actionable Impact:**
Adeu requires a dedicated `AddComment` action in the `DocumentChange` discriminated union. This allows an agent to pass a `target_text` and a `text` (the comment payload) to safely attach margin notes (`w:commentReference`) without invoking the text-replacement pipeline.

---

## 3. The "Net-New Document" Gap (Future Roadmap)

**The Legal Requirement:**
Certain workflows, particularly in litigation and compliance, require generating documents from scratch rather than redlining existing templates.
> *"`demand-draft`: Draft a demand letter... writes .../draft-v[N].docx using the docx skill."*
> *"`legal-hold`: Issue... drafts the hold notice as .docx."*

**Adeu's Current Limitation:**
Adeu is designed as a "Virtual DOM" proxy for *existing* documents. It requires an initial DOCX binary stream to parse, map, and apply patches against. It currently lacks a seamless "text-to-docx" compilation pipeline for blank-canvas generation.

**Roadmap Impact:**
While outside the immediate scope of contract negotiation/redlining, supporting a `create_docx(markdown_content)` tool is necessary to capture the full spectrum of legal agent workflows (e.g., generating first-draft memos, demand letters, or closing checklists).

---

## 4. Security: Untrusted Input & Formula Injection

**The Legal Requirement:**
The legal agents treat all document content as inherently hostile.
> *"Counterparty-sourced text (contract quotes... ) is attacker-controlled. A cell starting with `=`, `+`, `-`, `@`... will be interpreted as a formula..."* (`tabular-review/SKILL.md`)

**Adeu's Alignment: Strong**
Adeu's read-only extraction phase (`ingest.py`) safely converts OOXML into raw text/Markdown. By stripping active macros, executing strict `lxml` mathematical scrubs for metadata sanitization, and isolating the LLM from the raw XML, Adeu acts as a reliable airgap. Adeu ensures that an agent analyzing a malicious counterparty draft only interacts with sanitized, projected strings, preventing XML-based payload execution.

---

## 5. Context Window & Large Document Handling

**The Legal Requirement:**
Agents are explicitly warned about silently failing on large documents.
> *"When a skill reads a document... and the input is LARGE (roughly >50 pages)... do not silently produce a confident output from a partial read... The failure mode is: the model ingests until context fills, truncates..."* (`Shared Guardrails`)

**Adeu's Alignment: Actionable**
Adeu's transition to CriticMarkup is highly token-efficient compared to raw XML. However, for massive documents (e.g., 150-page Credit Agreements), passing the entire `read_docx` output might still blow out standard context windows. 
*   **Impact:** Adeu's architecture natively supports this via the `pagination.py` module, but the `read_docx` tool should explicitly enforce and advertise pagination (e.g., `read_docx(page=1)`) to allow agents to "chunk" their review in compliance with their own safety prompts.

---

## Conclusion
Anthropic's `claude-for-legal` proves that LLMs are perfectly capable of executing complex legal workflows, *provided the toolchain abstracts away the formatting execution*. Adeu's design is the exact missing link these agents assume exists. Implementing an `AddComment` primitive is the highest-ROI immediate step to reduce token usage and support the primary "Review & Flag" agent paradigm.