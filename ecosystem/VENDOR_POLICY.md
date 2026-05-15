# Adeu Ecosystem: Vendor & Integration Policy

To maintain the high reliability and zero-dependency nature of the core Adeu platform, all third-party and vendor contributions to the `ecosystem/` directory must strictly adhere strictly to the following governance rules. 

By submitting a Pull Request to this directory, you agree to these terms.

## 1. Zero Core Coupling
The Adeu core (`src/adeu/` and `node/packages/core/`) is an infrastructure-level XML manipulation engine. 
*   **No Middleware:** We will not accept PRs that inject business logic, vendor-specific hooks, or external API callbacks directly into the `RedlineEngine` or the core execution loop.
*   **Composition Over Modification:** Your integration must wrap, compose, or sequence Adeu's public interfaces (like the Python SDK or the standard MCP tools) rather than modifying Adeu's internal behavior.

## 2. Strict Dependency Isolation
Ecosystem projects must not pollute the root repository's dependency tree.
*   **Python:** You must include your own `pyproject.toml` in your folder. Your dependencies must be managed independently via `uv`. You must **not** add your dependencies to the root `python/pyproject.toml`.
*   **TypeScript / Node:** You must include your own `package.json`. Your folder will explicitly *not* be added to the root `workspaces` array.

## 3. Transparency & Paywalls
We welcome commercial vendors building integrations. However:
*   If your integration requires a paid API key or commercial subscription (e.g., to a legal database or CLM), this must be **prominently stated at the top of your folder's `README.md`**.
*   Telemetry or data-collection within your integration must be strictly opt-in or transparently documented.

## 4. Maintenance SLA & Pruning (The "Rot" Policy)
APIs drift, dependencies upgrade, and companies pivot. We will not allow unmaintained vendor code to drag down the Adeu repository.
*   If a core Adeu update breaks your integration, or if your integration's CI tests begin failing due to upstream dependency rot, we will tag the designated maintainer(s) in a GitHub Issue.
*   **14-Day SLA:** You have 14 days to submit a fix.
*   If no fix is provided, your integration will be moved to `ecosystem/deprecated/` or deleted entirely. We reserve the right to prune broken ecosystem code at any time to keep the repository healthy.

## 5. Security & Quality
*   Do not commit secrets, API keys, or sensitive customer data.
*   Your integration should ideally include its own isolated test suite.
*   We reserve the right to reject integrations that perform dangerous file-system operations or violate standard security practices.