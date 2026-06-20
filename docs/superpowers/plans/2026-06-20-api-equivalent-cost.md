# API-Equivalent Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace session-cost display with estimated API-equivalent cost calculated from latest assistant-message tokens and a configurable per-model price table.

**Architecture:** Keep `tui.js` as the single plugin module. Add small pure helpers for model key normalization, price table merging, per-message cost calculation, and aggregate cost state, then reuse existing sidebar rendering and refresh lifecycle.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode TUI plugin API, OpenTUI Solid runtime, GitHub pinned plugin installs.

## Global Constraints

- Always answer and document in Chinese-facing final summaries unless user asks otherwise.
- Target OpenCode version: verified against `opencode --version` output `1.17.8`.
- TUI plugin config lives in `tui.json`, with global config at `~/.config/opencode/tui.json`.
- Do not add a server plugin target or mutate provider/model behavior.
- Keep `sidebar_content` order `101` and do not replace built-in `Context`.
- Cost display must never use OpenCode session-level `cost`.
- Missing price for any relevant non-zero-token message must render `API cost unavailable`, not `$0.00 total`.
- Use full commit SHA in the final global install spec.

---

## File Structure

- Modify `tui.js`: add price table, price normalization, cost calculation, state fields, and cost rendering.
- Modify `test/tui.test.js`: add RED/GREEN tests for built-in pricing, missing-price unavailable, config override, and ignoring session cost.
- Modify `README.md`: document estimated API-equivalent cost, built-in prices, override format, and missing-price behavior.
- Modify `package.json`: bump version for release.
- Modify `~/.config/opencode/tui.json`: update global pinned plugin SHA after release.

### Task 1: Add API-Equivalent Cost Tests

**Files:**
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `computeSidebarState(api, sessionID, options)` existing state object.
- Produces expected new state fields: `costAvailable: boolean`, `cost: number` when available.

- [ ] **Step 1: Write failing test for built-in OpenAI pricing and ignored session cost**

Add a test that creates a root session and one child session with `cost: 999`, latest assistant messages using `providerID: "openai"`, `modelID: "gpt-5.5"`, and tokens. Assert that `computeSidebarState` returns the calculated API-equivalent cost, not `999`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current implementation sums `session.cost`.

- [ ] **Step 3: Write failing test for missing price**

Add a test with `providerID: "unknown"`, `modelID: "missing-model"`, and non-zero tokens. Assert `costAvailable === false` and no `$0.00 total` rendering.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current implementation has no missing-price state.

- [ ] **Step 5: Write failing test for option price override**

Add a test that passes `computeSidebarState(api, "root", { prices: { "openai/gpt-5.5": { input: 1, output: 2, cacheRead: 0.5 } } })` and asserts override prices are used.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current implementation ignores `options.prices`.

### Task 2: Implement Pricing Helpers

**Files:**
- Modify: `tui.js`

**Interfaces:**
- Produces `messageInfo(message): object`, `priceForMessage(message, options): object | undefined`, `costForMessage(message, options): { available: boolean, cost: number }`.

- [ ] **Step 1: Add built-in price table**

Add `BUILT_IN_PRICES` keyed by lowercase `provider/model` with GPT-5.5, GPT-5.5 Pro, GPT-5.4, and GPT-5.4 mini prices from the design spec.

- [ ] **Step 2: Add message info helper**

Reuse wrapper handling by centralizing `message?.info ?? message` so token math and price math inspect the same object.

- [ ] **Step 3: Add price lookup and cost math**

Normalize `providerID/modelID` to lowercase. Merge `{ ...BUILT_IN_PRICES, ...options.prices }`. Compute cost as `(tokens.input * input + tokens.output * output + tokens.reasoning * reasoning + tokens.cache.read * cacheRead + tokens.cache.write * cacheWrite) / 1_000_000`.

- [ ] **Step 4: Update aggregate state**

In `computeSidebarState`, read each session's latest assistant message once, derive tokens and cost from it, and set `costAvailable` false if any relevant non-zero-token message lacks a price.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all cost tests and existing tests PASS.

### Task 3: Render API Cost Availability

**Files:**
- Modify: `tui.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: sidebar state fields `costAvailable` and `cost`.

- [ ] **Step 1: Add failing render tests**

Assert `createSidebarElement` renders `$0.09 total` when `costAvailable: true`, and `API cost unavailable` when `costAvailable: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL if current renderer always formats numeric `cost`.

- [ ] **Step 3: Implement render change**

Render `API cost unavailable` when `state.costAvailable === false`; otherwise render formatted cost.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

### Task 4: Documentation, Version, Release

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces new pinned release commit for global install.

- [ ] **Step 1: Update README**

Document estimated API-equivalent cost, built-in OpenAI prices, option override JSON, and missing-price unavailable behavior.

- [ ] **Step 2: Bump package version**

Bump from `0.1.3` to `0.1.4`.

- [ ] **Step 3: Run full local verification**

Run: `npm test`

Run: `npm pack --dry-run`

Expected: tests PASS, package contains only `LICENSE`, `README.md`, `package.json`, `tui.js`.

- [ ] **Step 4: Commit and push**

Run: `git status --short`, `git diff`, `git log --oneline -10`, then commit intended files and push.

- [ ] **Step 5: Create GitHub release**

Create `v0.1.4` targeting the full commit SHA.

### Task 5: Global Install and Real TUI Verification

**Files:**
- Modify: `/Users/ol125/.config/opencode/tui.json`

**Interfaces:**
- Consumes release full SHA from Task 4.

- [ ] **Step 1: Update global TUI config**

Replace the old `opencode-subagent-context` pinned SHA with the new full commit SHA. Preserve `opencode-codex-lb-switcher`.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('/Users/ol125/.config/opencode/tui.json','utf8')); console.log('valid json')"`

Expected: `valid json`.

- [ ] **Step 3: Restart tmux OpenCode smoke session**

Start OpenCode from the smoke workspace and create a prompt that launches one explore subagent.

- [ ] **Step 4: Capture sidebar**

Capture the pane and verify it shows `Context + Subagents`, a non-zero `from 1 subagent` line, and a non-zero `$... total` cost for `openai/gpt-5.5`.

- [ ] **Step 5: Final verification**

Run `npm test`, `git status --short`, `gh release view v0.1.4 --json tagName,targetCommitish,url`, and capture the smoke pane before reporting completion.

## Self-Review

- Spec coverage: pricing source, override behavior, missing-price behavior, docs, release, and global install are covered by Tasks 1-5.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `costAvailable` and `cost` are introduced in Task 1 and consumed in Task 3 consistently.
