## Pull Request Overview

Please provide a brief description of the changes introduced by this PR.

---

## 🛑 Ecosystem / Vendor Integrations (READ FIRST)
*If you are submitting a new third-party integration, API connector, or LegalTech tool to the `ecosystem/` directory, you **must** complete this checklist. PRs that fail to meet these criteria will be automatically closed without review.*

- [ ] **Zero Core Coupling:** I confirm this PR does NOT modify `src/adeu/` or `node/packages/core/`. All execution logic is self-contained or strictly uses approved callback/middleware hooks.
- [ ] **Strict Dependency Isolation:** I have included a dedicated package manager file (`pyproject.toml` or `package.json`) exclusively within my `ecosystem/<plugin>/` directory. My dependencies do not pollute the root lockfiles.
- [ ] **No Hoisting / Phantom Dependencies:** I am using explicit workspace protocols (e.g., `workspace:*` or `adeu = { path = "../../python" }`) to reference the core engine.
- [ ] **Commercial Transparency:** If my integration requires a paid subscription, API key, or routes to a closed-source endpoint, it is explicitly declared at the very top of my `README.md`.
- [ ] **14-Day Maintenance SLA:** I have read and agree to the `VENDOR_POLICY.md`. I acknowledge that I am responsible for the perpetual OpEx of this code. If this integration breaks and I fail to resolve the issue within 14 days, I understand the integration will be aggressively pruned/deleted.

---

## 🛠️ Core Engine Contributions
*If you are contributing to the core Adeu OpenXML parsing engine or standard MCP tooling:*

- [ ] I have added a regression test (e.g., `tests/test_repro_issue_name.py`) to prove the bug is fixed or the feature handles Edge-Case OpenXML correctly.
- [ ] I have verified that changes to `RedlineEngine` do not cause silent DOM corruption (e.g., bypassing `w:ins`/`w:del` tags).
- [ ] I have run the formatting and linting suite (`uv run ruff format .` and `uv run mypy src`).
- [ ] (If applicable) I have tested this against Live MS Word via COM (`live_word.py`) to ensure parity between Disk and Live operations.

## Related Issues
Closes # (Issue Number)