# Cumulative Usage Sidebar Design

## Goal

Change the sidebar block from current context semantics to cumulative usage semantics for both tokens and API-equivalent cost.

## Behavior

The plugin displays cumulative usage for the active main session plus all descendant subagent sessions.

The block title changes from `Context + Subagents` to `Usage + Subagents` so the display no longer suggests current context size.

The displayed lines are:

```text
Usage + Subagents
123,456 tokens used total
+45,678 used by 3 subagents
$0.42 spent total
```

## Token Semantics

For each relevant session, cumulative tokens are the sum across every assistant message with non-zero output tokens returned by OpenCode's `session.messages` API.

Each assistant message uses the same token formula as OpenCode's built-in context display:

```text
input + output + reasoning + cache.read + cache.write
```

This means auto compaction no longer makes the plugin's token total go down. If OpenCode records compaction or summary generation as assistant messages with token usage, those messages are included in the cumulative total.

## Cost Semantics

The plugin continues to ignore OpenCode session-level `cost` because OpenAI subscription-backed provider usage can report zero there.

Estimated API-equivalent cost is cumulative. It is calculated by applying the configured model price table to every assistant message with non-zero output tokens in the main session and descendant subagent sessions.

If any included assistant message has no matching price, only the cost line becomes unavailable:

```text
API cost unavailable
```

Token totals still render when cost is unavailable.

## Data Flow

The plugin still discovers descendants with `session.children` when available and falls back to `session.list` plus `parentID` traversal when needed.

For each session id, it reads all messages needed for cumulative usage. It must not use `DEFAULT_MESSAGE_LIMIT` for cumulative calculations because a fixed recent-message limit would undercount long sessions. Tests use `messageLimit` only as an explicit test/development override.

## Compatibility

Message shape support remains unchanged:

- Plain message objects with `role: "assistant"` or `type: "assistant"`
- OpenCode `session.messages` wrapper objects with `{ info, parts }`

The price table and plugin tuple override format from `v0.1.4` remain supported.

## Verification

Use the same release loop as previous versions:

1. Write failing tests that prove multiple assistant messages are accumulated.
2. Implement the minimal aggregation change.
3. Run `npm test` and `npm pack --dry-run`.
4. Commit, push, and create a GitHub release.
5. Update global `~/.config/opencode/tui.json` to the full pinned commit SHA.
6. Restart OpenCode in a smoke tmux session with a real subagent.
7. Verify the sidebar shows `Usage + Subagents`, cumulative token wording, a non-zero subagent token line, and cumulative API-equivalent spent.
