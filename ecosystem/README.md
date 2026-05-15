# Adeu Ecosystem & Integrations

Welcome to the Adeu Ecosystem directory. 

Adeu's core (`RedlineEngine` and MCP Server) is an **un-opinionated Virtual DOM** for DOCX files. It strictly handles the complex OpenXML manipulation required to translate LLM text edits into native Word Track Changes and Comments. 

Because we keep the core engine strictly decoupled from business logic, this `ecosystem/` directory serves as the official home for third-party integrations, LegalTech vendor workflows, and advanced agentic architectures built *on top* of Adeu.

## Categories

*   **Legal Validation & Research:** Routing proposed edits through case-law APIs or statutory databases before applying them to the DOCX.
*   **CLM Integrations:** Syncing Adeu's CriticMarkup extraction with external Contract Lifecycle Management platforms.
*   **Custom Agent Workflows:** Specialized LangChain, LlamaIndex, or AutoGen orchestrations utilizing Adeu as a tool.

## Active Integrations

| Integration | Description | Language | Maintainer |
| :--- | :--- | :--- | :--- |
| *(Coming Soon)* | *Your integration here.* | - | - |

## Contributing an Integration

We welcome PRs from vendors and the community! To protect the stability of the core engine, all integrations must strictly adhere to the [Vendor & Integration Policy](VENDOR_POLICY.md).

**Quick Start:**
1. Read the [Vendor Policy](VENDOR_POLICY.md).
2. Create a new directory: `ecosystem/<your-project-name>/`.
3. Provide your own isolated dependency file (`pyproject.toml` with `uv`, or `package.json`).
4. Include a dedicated `README.md` in your folder explaining the use case, setup, and any API keys required.
5. Submit a PR.