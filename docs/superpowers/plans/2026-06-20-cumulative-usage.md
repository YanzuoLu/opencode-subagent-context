# Cumulative Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace current-context token/cost display with cumulative token usage and cumulative API-equivalent spend for the main session plus descendant subagents.

**Architecture:** Keep the plugin as a single TUI module. Reuse descendant discovery and price-table helpers, but replace latest-message aggregation with all-assistant-message accumulation per session.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode TUI plugin API, OpenTUI Solid runtime, GitHub pinned plugin installs.

## Global Constraints

- Target OpenCode version: verified against `opencode --version` output `1.17.8`.
- TUI plugin config lives in `tui.json`, with global config at `~/.config/opencode/tui.json`.
- Do not add a server plugin target or mutate provider/model behavior.
- Keep `sidebar_content` order `101` and do not replace built-in `Context`.
- The displayed plugin title must be `Usage + Subagents`.
- Token totals must be cumulative across all assistant messages with non-zero output tokens, not latest-message context tokens.
- Cost must be cumulative API-equivalent spend from the same included assistant messages and must never use OpenCode session-level `cost`.
- Missing price for any included assistant message must render `API cost unavailable`, not `$0.00 spent total`.
- Use full commit SHA in the final global install spec.

---

## File Structure

- Modify `tui.js`: replace latest-message aggregation with per-session cumulative aggregation; update display strings.
- Modify `test/tui.test.js`: update existing expectations and add RED tests for multi-message cumulative tokens/cost.
- Modify `README.md`: document cumulative usage semantics and compaction behavior.
- Modify `package.json`: bump version for release.
- Modify `/Users/ol125/.config/opencode/tui.json`: update global pinned SHA after release.

### Task 1: Add Cumulative Usage RED Tests

**Files:**
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `computeSidebarState(api, sessionID, options)`.
- Produces expected state fields: `mainTokens`, `subagentTokens`, `totalTokens`, `subagentCount`, `cost`, `costAvailable` with cumulative semantics.

- [ ] **Step 1: Add failing cumulative token/cost test**

Add a test where root has two assistant messages and child has two assistant messages. Assert the state sums all assistant message tokens and all corresponding costs, instead of only latest messages.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current code only uses `latestContextMessage`.

- [ ] **Step 3: Add failing render wording test**

Update `createSidebarElement` expectations to require `Usage + Subagents`, `tokens used total`, `used by N subagents`, and `spent total`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because current renderer says `Context + Subagents`, `tokens total`, `from N subagents`, and `$... total`.

### Task 2: Implement Cumulative Aggregation

**Files:**
- Modify: `tui.js`

**Interfaces:**
- Produces helper behavior: read all messages for each session, sum `contextTokensForMessage(message)`, and sum `costForMessage(message, options)` for all included assistant messages.

- [ ] **Step 1: Replace latest-message helper**

Replace `latestContextMessage` with a cumulative helper that returns `{ tokens, cost, costAvailable }` for one session.

- [ ] **Step 2: Avoid default message limit for cumulative reads**

Change `readSessionMessages` so it omits `limit` by default. Keep `options.messageLimit` as an explicit override for tests and diagnostics.

- [ ] **Step 3: Update aggregate state loop**

For each id in `[sessionID, ...descendants]`, add cumulative session tokens/cost into main or subagent buckets. Count a descendant as a subagent when its cumulative token total is greater than zero.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all aggregation tests PASS.

### Task 3: Update Rendering and Documentation

**Files:**
- Modify: `tui.js`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: cumulative state from Task 2.

- [ ] **Step 1: Update renderer strings**

Render exactly `Usage + Subagents`, `${tokens} tokens used total`, `+${tokens} used by ${count} subagent(s)`, and `${money} spent total`.

- [ ] **Step 2: Update README**

Document cumulative token usage, cumulative API-equivalent spend, compaction behavior, and missing-price behavior.

- [ ] **Step 3: Bump version**

Bump `package.json` from `0.1.4` to `0.1.5`.

- [ ] **Step 4: Run tests and package check**

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

Create `v0.1.5` targeting the full commit SHA.

- [ ] **Step 3: Update global pinned config**

Replace the old `opencode-subagent-context` SHA in `/Users/ol125/.config/opencode/tui.json` with the new full SHA. Preserve `opencode-codex-lb-switcher`.

- [ ] **Step 4: Validate global config**

Run: `node -e "JSON.parse(require('fs').readFileSync('/Users/ol125/.config/opencode/tui.json','utf8')); console.log('valid json')"`

Expected: `valid json`.

- [ ] **Step 5: Run real TUI smoke**

Start OpenCode in a directory with no local `.opencode/tui.json`, launch one explore subagent, and capture the pane.

Expected sidebar: `Usage + Subagents`, non-zero `tokens used total`, non-zero `used by 1 subagent`, and non-zero `$... spent total` for `openai/gpt-5.5`.

- [ ] **Step 6: Final verification**

Run `npm test`, `git status --short`, `gh release view v0.1.5 --json tagName,targetCommitish,url`, validate global JSON, and capture the smoke pane before reporting completion.

## Self-Review

- Spec coverage: cumulative tokens, cumulative cost, missing-price behavior, display wording, docs, release, and global install are all covered.
- Placeholder scan: no placeholder tasks remain.
- Type consistency: `costAvailable`, `cost`, `mainTokens`, `subagentTokens`, and `totalTokens` keep the existing state shape while changing semantics to cumulative.
