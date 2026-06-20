# Usage Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show cumulative input/output/reasoning/cache-read/cache-write token and cost breakdown lines under the existing cumulative usage totals.

**Architecture:** Keep `tui.js` as the single plugin module. Extend existing cumulative aggregation to track per-category token totals, subagent-token totals, and category costs while preserving the top-level totals.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode TUI plugin API, OpenTUI Solid runtime, GitHub pinned plugin installs.

## Global Constraints

- Target OpenCode version: verified against `opencode --version` output `1.17.8`.
- TUI plugin config lives in `tui.json`, with global config at `~/.config/opencode/tui.json`.
- Do not add a server plugin target or mutate provider/model behavior.
- Keep `sidebar_content` order `101` and do not replace built-in `Context`.
- The displayed plugin title must be `Usage`.
- Preserve the first three metric lines: `tokens used total`, `used by N subagents`, and `spent total`.
- Add breakdown lines for `in`, `out`, `rsn`, `cache`, and `write` in that exact order.
- Breakdown line format is `<label> <total tokens> (+<subagent tokens>) / <total cost>`.
- Missing price for a category with non-zero tokens must render that category cost as `unavailable` and total cost as `API cost unavailable`.
- Use full commit SHA in the final global install spec.

---

## File Structure

- Modify `tui.js`: add category constants, category token extraction, category cost calculation, breakdown aggregation, and rendering.
- Modify `test/tui.test.js`: add tests for breakdown state and rendering.
- Modify `README.md`: document title and breakdown lines.
- Modify `package.json`: bump version for release.
- Modify `/Users/ol125/.config/opencode/tui.json`: update global pinned SHA after release.

### Task 1: Add Breakdown RED Tests

**Files:**
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `computeSidebarState(api, sessionID, options)` and `createSidebarElement(api, state, view)`.
- Produces expected new state field: `breakdown` with per-category token and cost data.

- [ ] **Step 1: Add failing aggregation test**

Add a test with main and child assistant messages containing input, output, reasoning, cache read, and cache write. Assert `breakdown.input`, `breakdown.output`, `breakdown.reasoning`, `breakdown.cacheRead`, and `breakdown.cacheWrite` include total tokens, subagent tokens, category cost, and cost availability.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current state has no `breakdown`.

- [ ] **Step 3: Add failing render test**

Update `createSidebarElement` expectation to require title `Usage` and five breakdown lines after the existing three metrics.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current renderer has title `Usage + Subagents` and no breakdown lines.

### Task 2: Implement Breakdown Aggregation

**Files:**
- Modify: `tui.js`

**Interfaces:**
- Produces state `breakdown` keyed by `input`, `output`, `reasoning`, `cacheRead`, `cacheWrite`.

- [ ] **Step 1: Add category definitions**

Define category metadata for labels, token paths, and price fields.

- [ ] **Step 2: Add category cost helper**

For a message and price, calculate cost per category using per-1M pricing. If price is missing and category tokens are non-zero, mark category unavailable.

- [ ] **Step 3: Extend cumulative aggregation**

While summing each included assistant message, add per-category token totals and cost totals. Separately add subagent tokens when aggregating descendant sessions.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: aggregation tests PASS.

### Task 3: Render Breakdown and Update Docs

**Files:**
- Modify: `tui.js`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: state `breakdown` from Task 2.

- [ ] **Step 1: Render title and breakdown lines**

Change title to `Usage`. Keep the existing first three metrics. Append lines in this order: `in`, `out`, `rsn`, `cache`, `write`.

- [ ] **Step 2: Update README**

Document the title, first three preserved metric lines, breakdown line format, labels, and unavailable behavior.

- [ ] **Step 3: Bump version**

Bump `package.json` from `0.1.5` to `0.1.6`.

- [ ] **Step 4: Run local verification**

Run: `npm test`

Run: `npm pack --dry-run`

Expected: tests PASS; package contains only `LICENSE`, `README.md`, `package.json`, `tui.js`.

### Task 4: Release and Real Global Verification

**Files:**
- Modify: `/Users/ol125/.config/opencode/tui.json`

**Interfaces:**
- Consumes release full SHA from the implementation commit.

- [ ] **Step 1: Commit and push**

Inspect `git status --short`, `git diff`, and `git log --oneline -10`; commit intended files and push.

- [ ] **Step 2: Create GitHub release**

Create `v0.1.6` targeting the full commit SHA.

- [ ] **Step 3: Update global pinned config**

Replace the old `opencode-subagent-context` SHA in `/Users/ol125/.config/opencode/tui.json` with the new full SHA. Preserve `opencode-codex-lb-switcher`.

- [ ] **Step 4: Validate global config**

Run: `node -e "JSON.parse(require('fs').readFileSync('/Users/ol125/.config/opencode/tui.json','utf8')); console.log('valid json')"`

Expected: `valid json`.

- [ ] **Step 5: Run real TUI smoke**

Start OpenCode in a directory with no local `.opencode/tui.json`, launch one explore subagent, and capture the pane.

Expected sidebar: `Usage`, preserved top three metric lines, and all five breakdown lines with token counts and costs or `unavailable`.

- [ ] **Step 6: Final verification**

Run `npm test`, `git status --short`, `gh release view v0.1.6 --json tagName,targetCommitish,url`, validate global JSON, and capture the smoke pane before reporting completion.

## Self-Review

- Spec coverage: title, preserved top lines, per-category lines, cost availability, docs, release, and global install are all covered.
- Placeholder scan: no placeholder tasks remain.
- Type consistency: `breakdown` category keys match the design: `input`, `output`, `reasoning`, `cacheRead`, `cacheWrite`.
