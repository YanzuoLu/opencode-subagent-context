# Subagent Context Sidebar Design

## Goal

Build an OpenCode TUI plugin that shows current main-agent context tokens plus current subagent context tokens in the right sidebar, installable by a single pinned GitHub plugin spec.

## Context

OpenCode 1.17.8 renders the right sidebar through TUI `sidebar_content` slots. The built-in `internal:sidebar-context` plugin registers order `100` and displays `Context` from the current session's last assistant message with tokens. Existing local examples show that GitHub plugin specs can be installed from JSON when pinned to a full commit SHA.

## Scope

The plugin renders a separate block immediately after the built-in Context block. It does not modify or disable built-in internal plugins. It does not change model requests, providers, prompts, or server hooks.

## Display

The default sidebar block is:

```text
Context + Subagents
128,234 tokens total
+14,823 from 3 subagents
$0.02 total
```

The first line is main session current-context tokens plus all descendant subagent current-context tokens. The second line is only descendant subagent current-context tokens and the number of descendant sessions with non-zero context tokens. Cost uses session-level `cost` totals because the built-in Context already displays session cost rather than per-message context cost.

## Data Model

The plugin uses `props.session_id` from `sidebar_content` as the main session id. It reads sessions from `api.client.session.list({ directory, workspace, scope: "project", roots: false, limit, start })` and uses `parentID` to find descendants of the current session. It reads recent messages for each relevant session using `api.client.session.messages({ sessionID, directory, workspace, limit })` and finds the latest assistant message with tokens.

Message compatibility supports both OpenCode message shapes:

- Legacy TUI sync shape: `role: "assistant"`, `tokens.output > 0`
- Projected v2 shape: `type: "assistant"`, `tokens.output > 0`

Current-context token sum matches OpenCode's built-in formula:

```text
input + output + reasoning + cache.read + cache.write
```

Session-level totals are not used for the displayed token total because they represent cumulative usage and would not match the built-in Context number.

## Refresh Strategy

The plugin loads once at initialization and refreshes the active sidebar block asynchronously. It subscribes to session and message events that can change the parent tree or latest assistant tokens:

- `session.created`
- `session.updated`
- `session.deleted`
- `message.updated`
- `session.next.step.ended`

Refreshes are debounced. After state changes, the plugin calls `api.renderer.requestRender()` when available.

## Error Handling

The plugin must never throw from slot rendering. If API reads fail, it shows `subagent total unavailable` in muted text and retries on the next event or timer. If no subagents are found, it shows zero subagent contribution while still showing the main session total.

## Packaging

The package is pure TUI:

- `package.json` has `exports["./tui"]` pointing to `./tui.js`.
- No `main` field is used, so OpenCode does not detect a server target.
- The default export is `{ id: "opencode-subagent-context", tui }`.
- README documents one-line `tui.json` installation with `git+https://github.com/YanzuoLu/opencode-subagent-context.git#<full-commit-sha>`.

## Verification

Automated tests cover token math, descendant discovery, message shape compatibility, no-subagent behavior, API failure behavior, and slot registration order. Manual verification uses tmux to resume an existing OpenCode session that already has subagents or creates one before validating the sidebar, because a no-subagent session does not prove the requested behavior.

## Release Loop

The implementation loop is:

1. Implement through TDD.
2. Run unit tests and package checks.
3. Commit and push to `YanzuoLu/opencode-subagent-context`.
4. Create a GitHub release.
5. Install by pinned commit spec in TUI JSON.
6. Restart/resume OpenCode in tmux.
7. Verify on a session with subagents.
8. If verification fails, fix, commit, push, update pinned commit, reinstall, restart, and retest.
