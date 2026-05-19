# Handover Document: n8n-nodes-adeu (Session 3)

**Project:** Bundling `@adeu/core` into `n8n-nodes-adeu` for n8n Cloud compatibility and verified-publisher submission.

**Location:** `D:\Dev\Adeu_dev\adeu\node\packages\n8n-nodes-adeu` (inside the monorepo at `node/`).

---

## 1. Context for the Next LLM

You are taking over a session where we have been preparing the `n8n-nodes-adeu` community node for npm publishing. The node wraps `@adeu/core` (a TypeScript DOCX redlining engine, also in this monorepo at `node/packages/core`) and exposes four operations: `Extract Markdown`, `Apply Edits`, `Generate Diff`, `Finalize Document`.

**The user's working agreement (critical — read carefully):**

- Auto-applies your code blocks from `// FILE: <path>` headers
- **Do not rewrite whole files when not needed** — give targeted edits
- **No hallucinations** — if you need a file you can't see, stop and ask
- **Be a critical partner** — challenge flawed instructions, propose better solutions
- **Hard stops** — end with `[AWAITING USER RESPONSE]` when you need input

**Project Constitution:** `AI_CONTEXT.md` at the monorepo root. The most relevant section for this work is **§14 (TypeScript / Node.js Engine Constraints)** and the **Native Desktop Extension (MCPB)** pattern in §4 — both describe the existing precedent for bundling `@adeu/core` into a zero-dependency artifact.

---

## 2. What's Been Accomplished

### Session 1
- Wrote initial draft of the n8n node (programmatic-style, 4 operations, modular descriptions folder, `GenericFunctions.ts` with `mapAdeuErrorToNodeApiError`)
- Confirmed end-to-end DOCX flow works in a local n8n instance via `npm link`

### Session 2 (this session)
1. **Display name fixed**: `"Adeu — DOCX Redlining"` → `"Adeu"` in `Adeu.node.ts`
2. **`package.json` updated**:
   - Version `0.1.0` → `1.0.0`
   - Added `lint` and `lintfix` scripts
   - ESLint `^8.57.1` → `^9.0.0`
   - Added `@typescript-eslint/parser@^8.35.0` to devDependencies
3. **`eslint.config.mjs` created** (flat config, ESLint 9). Final working version:
   ```javascript
   // FILE: node/packages/n8n-nodes-adeu/eslint.config.mjs
   import { n8nCommunityNodesPlugin } from "@n8n/eslint-plugin-community-nodes";
   import tsParser from "@typescript-eslint/parser";

   export default [
     {
       ignores: ["dist/**", "node_modules/**", "test/**", "**/*.test.ts"],
     },
     {
       files: ["nodes/**/*.ts"],
       languageOptions: {
         parser: tsParser,
         ecmaVersion: 2022,
         sourceType: "module",
       },
     },
     n8nCommunityNodesPlugin.configs.recommended,
   ];
   ```
4. **Linter runs successfully**, surfacing 6 real errors + 1 warning (see §3)
5. **SVG icon prepared**: User has converted `adeu.png` → `adeu.svg`. They have NOT yet placed it or updated `Adeu.node.ts` — **this is your first task**.

### Key learnings about the n8n linter (avoid wasted cycles)

- `@n8n/eslint-plugin-community-nodes@0.15.0` requires **ESLint ≥9 + flat config**
- The plugin ships **only rules + plugin registration** — it does NOT supply a TypeScript parser or `files` globs
- We must explicitly add `@typescript-eslint/parser` and a `files` config for `nodes/**/*.ts`
- Workspace setup hoists `node_modules` to `node/node_modules/`, not `node/packages/n8n-nodes-adeu/node_modules/` — this is correct behavior
- TypeScript 6.0.3 is real and current (released March 2026)

---

## 3. Current Lint State (Final Diagnostic Output)

```
Adeu.node.ts
  16:8   error  Node class should have usableAsTool property         @n8n/community-nodes/node-usable-as-tool
  20:11  error  Icon file "adeu.png" must be an SVG file              @n8n/community-nodes/icon-validation

descriptions/applyEdits.operation.ts
  7:1   error  Import of '@adeu/core' is not allowed                 @n8n/community-nodes/no-restricted-imports
descriptions/extractMarkdown.operation.ts
  6:1   error  Import of '@adeu/core' is not allowed                 @n8n/community-nodes/no-restricted-imports
descriptions/finalizeDocument.operation.ts
  6:1   error  Import of '@adeu/core' is not allowed                 @n8n/community-nodes/no-restricted-imports
descriptions/generateDiff.operation.ts
  6:1   error  Import of '@adeu/core' is not allowed                 @n8n/community-nodes/no-restricted-imports

package.json
  0:0   warning  File ignored because no matching configuration was supplied

✖ 7 problems (6 errors, 1 warning)
```

**Critical insight:** the `no-restricted-imports` rule is in BOTH the `recommended` AND `recommendedWithoutN8nCloudSupport` presets. There is no preset that allows runtime deps. The rule's message confirms the policy: *"n8n Cloud does not allow community nodes with dependencies."*

**User's chosen path: Option A — bundle `@adeu/core` into the node.** This produces a zero-dependency artifact, satisfies the rule, and is eligible for n8n Cloud + verified publisher.

---

## 4. Your Task: Bundle `@adeu/core` into the n8n node

### 4.1 What "bundling" means here

At build time, `tsup` (already in `node/package.json` devDependencies) inlines all of `@adeu/core`'s source and dependencies (`@xmldom/xmldom`, `diff-match-patch`, `jszip`, `xpath`) into a single CommonJS file: `dist/nodes/Adeu/Adeu.node.js`. At runtime, n8n loads that single file — no `node_modules` needed for the node.

This mirrors the **Native Desktop Extension (MCPB)** pattern documented in `AI_CONTEXT.md` §4: *"1.2MB bundle is ignored in `.gitignore`, built entirely via CI/CD, and distributed via NPM and GitHub Releases."*

### 4.2 Pre-flight checks before writing code

Before producing any code blocks, ask the user to confirm/paste:

1. **Verify the SVG icon is in place**:
   ```bash
   ls D:\Dev\Adeu_dev\adeu\node\packages\n8n-nodes-adeu\nodes\Adeu\adeu.svg
   ```
   If not at that path, ask where they put it.

2. **Read the current state of `Adeu.node.ts`** — it has been edited in this session. You need the current contents before editing. Read the file via `view` (if you have computer use) or ask the user to paste it.

3. **Read `node/packages/core/tsup.config.ts`** — you don't have it in context yet. You need to confirm how `@adeu/core` is built to understand what bundling its source into the n8n node looks like. Critical questions: does it externalize `@xmldom/xmldom`, `jszip`, etc., or bundle them? For our use case we want the **opposite** — bundle everything.

4. **Confirm whether the user wants `@adeu/core` to remain a `devDependency` (preferred — build-time only) or stay as a `dependency`** (would require additional `eslint-disable` workarounds). Default to `devDependency` per Option A.

### 4.3 The implementation plan

#### Step 1 — Trivial fixes (independent of bundling)

**A. Add `usableAsTool: true` to `Adeu.node.ts`**:
- Insert `usableAsTool: true,` near the top of the `description` object (e.g. after `displayName`)
- This signals the node is callable by AI Agent nodes — accurate for Adeu since LLMs are the primary consumers

**B. Switch icon reference**:
- Change `icon: "file:adeu.png"` → `icon: "file:adeu.svg"`
- Delete the obsolete `adeu.png` if user confirms it can go
- Update `copy-assets` script in `package.json` to copy `*.svg` instead of (or in addition to) `*.png`

#### Step 2 — Add `tsup` build config for the n8n node

Create `node/packages/n8n-nodes-adeu/tsup.config.ts`:
- Entry: `nodes/Adeu/Adeu.node.ts`
- Format: `cjs` (n8n loads nodes as CommonJS)
- Out dir: `dist/nodes/Adeu/`
- `noExternal: [/.*/ ]` or explicit `noExternal: ["@adeu/core", "@xmldom/xmldom", "diff-match-patch", "jszip", "xpath"]` to inline everything
- `target: "node18"` (n8n's minimum supported Node)
- `clean: true`
- `dts: false` (n8n doesn't consume types from installed nodes)
- `minify: false` (keep the published artifact debuggable + reviewable)
- `sourcemap: true` (or `false` — discuss with user; for first publish probably `false` to keep the artifact lean)

**Watch out for:**
- The bundle MUST remain a CommonJS file (`.js`, not `.mjs`) because n8n's main path is `dist/nodes/Adeu/Adeu.node.js`
- `@adeu/core` is published as `"type": "module"` with both `import` and `require` paths in its `exports` field — tsup will follow the `require` path automatically when output is CJS
- The `dynamic require` pattern in JSZip can trip up bundlers — if you get errors about `require` being treated as static, add `external: []` and `noExternal: [/.*/  ]` and check tsup's output

#### Step 3 — Update `package.json` of the n8n node

- Move `@adeu/core: ^1.7.1` from `dependencies` → `devDependencies`
- After bundling, **`dependencies` should be empty** (or removed entirely)
- Update `build` script: `tsup && npm run copy-assets`
- The existing `copy-assets` script still needs to copy the `.svg` and the `.json` codex file
- Confirm `main` in `package.json` points to `dist/nodes/Adeu/Adeu.node.js`
- Confirm `files` includes `dist`
- Confirm `n8n.nodes` entry points to `dist/nodes/Adeu/Adeu.node.js`

#### Step 4 — Re-run lint and verify

After steps 1–3:
```bash
npm install  # picks up tsup if not yet hoisted
npm run lint
```

Expected outcome: **all 6 errors gone** if:
- `usableAsTool` added
- SVG icon swapped
- `@adeu/core` import becomes a build-time concern (the `no-restricted-imports` rule checks the source, not the bundle — so this is the subtle part)

**⚠️ Important risk:** The `no-restricted-imports` rule lints **source files**, not the bundled output. So `import ... from '@adeu/core'` in the `.operation.ts` files will STILL trigger the rule, even if at runtime the dep is bundled away.

**Two ways to handle this:**

- **(a) Add per-file `eslint-disable` comments** at the top of the 4 operation files with a justification: `// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports -- bundled into dist via tsup`. Pragmatic but creates 4 disable directives.

- **(b) Override the rule globally in `eslint.config.mjs`** to ignore `@adeu/core` specifically. Cleaner — single config change. Check the rule's docs in `node_modules/@n8n/eslint-plugin-community-nodes/docs/` to see if it accepts an allowlist option. If not, fall back to (a).

**Ask the user which approach they prefer.** Option (a) makes the trade-off visible in every file. Option (b) hides it in one config file but is cleaner.

#### Step 5 — Validate the bundled artifact

After lint is green:
```bash
npm run build
ls dist/nodes/Adeu/
```

Expected files:
- `Adeu.node.js` (the bundle — should be ~1-1.5MB)
- `Adeu.node.json` (codex)
- `adeu.svg` (icon)

Then a local install test:
```bash
npm pack
# Move the resulting .tgz to ~/.n8n/custom and install:
# cd ~/.n8n/custom && npm install <path-to>/n8n-nodes-adeu-1.0.0.tgz
# Restart n8n, verify the node appears and the DOCX flow still works.
```

The pack/install test is the **definitive proof** that the bundle works in n8n's loader without `@adeu/core` present in any `node_modules`.

#### Step 6 — Handle the `package.json` lint warning

The remaining warning (`File ignored because no matching configuration was supplied` on `package.json`) is because the recommended preset's package.json rules are scoped via `files` patterns that don't match by default in flat config. This is a known plugin quirk.

**Fix:** add an explicit config block to `eslint.config.mjs`:
```javascript
{
  files: ["package.json"],
  // No parser override needed — ESLint reads JSON via the preset's processor
},
```

If this doesn't activate the preset's `community-package-json-*` rules, the cleanest fallback is to leave the warning as-is for now and address it during verified-publisher submission. **This is cosmetic, not blocking.**

---

## 5. What's Out of Scope (Deferred Tasks)

These were explicitly deferred from earlier sessions and remain so:

1. **GitHub Actions publishing workflow** with npm provenance (Task 2 from Session 2 handover) — required for verified publisher per the May 2026 rule but not for an initial unscoped npm publish
2. **`@nodes-testing/node-test-harness` workflow tests** — optional, defer until verified-publisher submission
3. **`n8n-workflow` peer-dep version bump** — plugin wants `>=2`, node has `^1.0.0`. Don't bump unless the v2 API actually breaks something. Verify by reading the n8n-workflow v2 changelog only if a peer-dep error blocks install.
4. **`LICENSE` file at the package root** — n8n-nodes-adeu folder doesn't have its own; relies on monorepo root. May need a copy for verified publisher. Cosmetic for now.
5. **Pinning `@adeu/core` to an exact version** — moot once it's bundled.

---

## 6. Files You'll Need to See

Ask the user to paste these at the start of your turn (you have NOT been given them):

1. **`node/packages/n8n-nodes-adeu/nodes/Adeu/Adeu.node.ts`** — modified this session, current state needed
2. **`node/packages/n8n-nodes-adeu/package.json`** — modified this session, current state needed
3. **`node/packages/core/tsup.config.ts`** — needed to align bundling strategy with how `@adeu/core` itself is built
4. **Output of `ls node/packages/n8n-nodes-adeu/nodes/Adeu/`** — to confirm the SVG is in place

Files you DO already have from this session:
- `eslint.config.mjs` (final version is in §2.3 above)
- `Adeu.node.json` codex (no changes needed)
- All four `*.operation.ts` files (unchanged this session)
- `GenericFunctions.ts` (unchanged this session)
- `test/Adeu.node.test.ts` (unchanged this session)
- `tsconfig.json` (unchanged this session)
- `node/packages/core/package.json` — confirms `@adeu/core@1.7.1` ships CJS via `require: "./dist/index.cjs"`

---

## 7. Suggested First Message from the Next LLM

> "Picking up from the Session 3 handover. Before I write any code, I need to see the current state of three files modified during the previous session:
>
> 1. `node/packages/n8n-nodes-adeu/nodes/Adeu/Adeu.node.ts`
> 2. `node/packages/n8n-nodes-adeu/package.json`
> 3. `node/packages/core/tsup.config.ts` (which I don't have in context yet)
>
> I also need confirmation that `adeu.svg` is in place at `nodes/Adeu/adeu.svg`. Once I have these, I'll produce the targeted edits and `tsup.config.ts` for the n8n node in a single pass.
>
> One open question for you: when we handle the `no-restricted-imports` rule blocking `@adeu/core` imports, do you prefer (a) per-file `eslint-disable` comments with a justification, or (b) a single global override in `eslint.config.mjs`? I'd lean (b) for cleanliness but (a) makes the build-time-only nature of the dep visible at every import site."

---

## 8. Definition of Done for This Phase

- [ ] `npm run lint` exits 0 (or only the cosmetic `package.json` warning remains)
- [ ] `npm run build` produces `dist/nodes/Adeu/Adeu.node.js` as a single bundled CJS file (~1-1.5MB)
- [ ] `dist/nodes/Adeu/` contains the bundle + `adeu.svg` + `Adeu.node.json`
- [ ] `npm pack` succeeds and the `.tgz` is reviewable
- [ ] Local install test in `~/.n8n/custom` loads the node and a real DOCX flow still works end-to-end
- [ ] `@adeu/core` is in `devDependencies`, not `dependencies`
- [ ] `dependencies` block in `package.json` is empty or removed

Once these are checked, the node is ready for `npm publish` (manual for now; GitHub Actions workflow is the next phase, deferred).

---

Good luck. The hard part is done — the linter is talking to us, the architectural decision is made, and the bundling pattern is well-precedented in this codebase. The remaining work is mechanical.