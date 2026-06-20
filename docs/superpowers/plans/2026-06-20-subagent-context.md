# Subagent Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and release an OpenCode TUI sidebar plugin that displays current main-agent context plus current subagent context.

**Architecture:** A pure TUI plugin registers one `sidebar_content` slot after the built-in Context slot. A small aggregation layer reads sessions, builds the descendant tree by `parentID`, reads recent messages, and computes current-context tokens from each latest assistant message.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode TUI plugin API, OpenTUI Solid runtime.

## Global Constraints

- Target OpenCode version: verified against `opencode --version` output `1.17.8`.
- Package must be installable from `tui.json` with one pinned GitHub spec.
- Do not add a server plugin target or mutate provider/model behavior.
- Do not replace built-in `internal:sidebar-context`; render after it with `sidebar_content` order `101`.
- Manual tmux verification must use or create a session with subagents.
- Use a full commit SHA in install instructions and real install tests.

---

## File Structure

- Create `package.json`: package metadata, pure TUI `./tui` export, test script, runtime dependencies.
- Create `tui.js`: plugin entrypoint, aggregation helpers, TUI element builders, refresh lifecycle.
- Create `test/tui.test.js`: unit tests for aggregation and slot behavior.
- Create `README.md`: usage, install, behavior, development, manual verification notes.
- Create `LICENSE`: MIT license.
- Modify docs only when implementation details change.

### Task 1: Scaffold Package and Failing Aggregation Tests

**Files:**
- Create: `package.json`
- Create: `test/tui.test.js`

**Interfaces:**
- Produces: desired exports from `tui.js`: `contextTokensForMessage(message)`, `collectDescendantIDs(sessions, rootID)`, `computeSidebarState(api, sessionID, options)`.

- [ ] **Step 1: Create package metadata**

```json
{
  "name": "opencode-subagent-context",
  "version": "0.1.0",
  "description": "Show OpenCode main plus subagent context tokens in the TUI sidebar.",
  "type": "module",
  "exports": {
    ".": "./tui.js",
    "./tui": "./tui.js"
  },
  "files": ["tui.js", "README.md", "LICENSE"],
  "scripts": { "test": "node --test" },
  "dependencies": {
    "@opentui/solid": "0.3.4",
    "solid-js": "1.9.12"
  },
  "keywords": ["opencode", "opencode-plugin", "tui", "subagent", "context"],
  "license": "MIT"
}
```

- [ ] **Step 2: Write failing tests**

```js
import test from "node:test"
import assert from "node:assert/strict"

import {
  collectDescendantIDs,
  computeSidebarState,
  contextTokensForMessage,
} from "../tui.js"

function tokens(input, output, reasoning = 0, read = 0, write = 0) {
  return { input, output, reasoning, cache: { read, write } }
}

test("contextTokensForMessage matches OpenCode Context token formula", () => {
  assert.equal(contextTokensForMessage({ role: "assistant", tokens: tokens(100, 50, 10, 5, 2) }), 167)
  assert.equal(contextTokensForMessage({ type: "assistant", tokens: tokens(20, 3, 2, 1, 4) }), 30)
  assert.equal(contextTokensForMessage({ role: "user", tokens: tokens(1, 1) }), 0)
  assert.equal(contextTokensForMessage({ role: "assistant", tokens: tokens(100, 0) }), 0)
})

test("collectDescendantIDs returns nested descendants without parents or siblings", () => {
  const sessions = [
    { id: "root" },
    { id: "child-a", parentID: "root" },
    { id: "grandchild", parentID: "child-a" },
    { id: "child-b", parentID: "root" },
    { id: "sibling-root" },
    { id: "sibling-child", parentID: "sibling-root" },
  ]

  assert.deepEqual(collectDescendantIDs(sessions, "root").sort(), ["child-a", "child-b", "grandchild"])
})

test("computeSidebarState sums current main context and descendant contexts", async () => {
  const api = makeApi({
    sessions: [
      { id: "root", cost: 0.01 },
      { id: "child", parentID: "root", cost: 0.02 },
      { id: "grandchild", parentID: "child", cost: 0.03 },
      { id: "other", cost: 9 },
    ],
    messages: {
      root: [{ role: "assistant", tokens: tokens(100, 10) }],
      child: [{ role: "assistant", tokens: tokens(20, 5) }],
      grandchild: [{ type: "assistant", tokens: tokens(1, 2, 3, 4, 5) }],
      other: [{ role: "assistant", tokens: tokens(999, 1) }],
    },
  })

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 110,
    subagentTokens: 40,
    totalTokens: 150,
    subagentCount: 2,
    cost: 0.06,
  })
})
```

- [ ] **Step 3: Run failing test**

Run: `npm test`

Expected: FAIL because `../tui.js` does not exist or exports are missing.

### Task 2: Implement Aggregation Helpers

**Files:**
- Create: `tui.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: tests from Task 1.
- Produces: `contextTokensForMessage`, `collectDescendantIDs`, `computeSidebarState`.

- [ ] **Step 1: Implement helpers minimally**

Create pure functions for message token math, descendant traversal, SDK response unwrapping, session listing, and recent-message lookup.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: PASS for aggregation tests.

- [ ] **Step 3: Add failing edge-case tests**

Add tests for cycles, no subagents, API failures returning `{ ok: false }`, and paginated `session.list` using `start`/`limit`.

- [ ] **Step 4: Implement edge cases**

Implement cycle guard, failure handling, and pagination.

- [ ] **Step 5: Run tests**

Run: `npm test`

Expected: all tests PASS.

### Task 3: Implement TUI Slot Rendering

**Files:**
- Modify: `tui.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `computeSidebarState(api, sessionID, options)`.
- Produces: default export `{ id: "opencode-subagent-context", tui }` and `createSidebarElement(api, state, view)`.

- [ ] **Step 1: Write failing slot tests**

Test that the default export has a TUI plugin shape, registers `sidebar_content` with `order: 101`, returns a block with `Context + Subagents`, and never throws on unavailable state.

- [ ] **Step 2: Run failing tests**

Run: `npm test`

Expected: FAIL because slot exports and element builder are missing.

- [ ] **Step 3: Implement TUI rendering**

Load OpenTUI/Solid runtime like `opencode-codex-lb-switcher/tui.js`, create `box`/`text` nodes, register slot, refresh state asynchronously, and request render on updates.

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: PASS.

### Task 4: Documentation and Package Checks

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Modify: `package.json` if needed.

**Interfaces:**
- Produces: install docs with pinned commit placeholder and development instructions.

- [ ] **Step 1: Add README and license**

Document `tui.json` install, restart requirement, display semantics, tmux verification requirement, and `npm test`.

- [ ] **Step 2: Run package checks**

Run: `npm test`

Run: `npm pack --dry-run`

Expected: tests pass and package includes only expected files.

### Task 5: GitHub Release and Pinned Install Test

**Files:**
- Modify: `README.md` after full commit SHA is known.

**Interfaces:**
- Produces: GitHub repo `YanzuoLu/opencode-subagent-context`, release `v0.1.0`, full commit install spec.

- [ ] **Step 1: Commit completed implementation**

Run `git status`, `git diff`, and `git log --oneline -10`, then commit intended files.

- [ ] **Step 2: Create and push repo**

Use `gh repo create YanzuoLu/opencode-subagent-context --public --source . --remote origin --push` unless the repo already exists.

- [ ] **Step 3: Pin README to full commit SHA**

Replace `<full-commit-sha>` with `git rev-parse HEAD`, commit, push, and use the new full commit SHA for install testing.

- [ ] **Step 4: Create release**

Run `gh release create v0.1.0 --title v0.1.0 --notes "Initial TUI sidebar plugin release."`.

### Task 6: tmux Install/Verification Loop

**Files:**
- Modify local test `tui.json` only for install verification, not committed unless user asks.

**Interfaces:**
- Consumes: pinned GitHub spec from Task 5.
- Produces: verified right-sidebar display in an OpenCode tmux session with subagents.

- [ ] **Step 1: Find an inactive tmux session**

Run `tmux list-sessions` and choose a session that is not actively attached or create a temporary one if no usable session exists.

- [ ] **Step 2: Ensure the session has subagents**

Resume or create an OpenCode session with at least one subagent. Do not accept a no-subagent session as verification.

- [ ] **Step 3: Install pinned plugin spec**

Write the pinned spec to the appropriate `tui.json` for the test workspace and restart OpenCode because TUI plugins load at startup.

- [ ] **Step 4: Verify with tmux send-keys/capture-pane**

Use `tmux send-keys` to interact and `tmux capture-pane` to confirm the sidebar shows `Context + Subagents` and a non-zero `from N subagents` line.

- [ ] **Step 5: Loop on failure**

If verification fails, diagnose, add a failing test when possible, fix, run tests, commit, push, update pinned SHA in test JSON, restart OpenCode, and repeat.
