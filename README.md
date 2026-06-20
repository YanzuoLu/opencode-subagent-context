# opencode-subagent-context

Show OpenCode main-agent context plus subagent context in the TUI sidebar.

## Usage

OpenCode 1.17.8 loads TUI plugins from `tui.json`. Add this one-line plugin entry and restart OpenCode:

```json
{
  "plugin": [
    "opencode-subagent-context@git+https://github.com/YanzuoLu/opencode-subagent-context.git#<full-commit-sha>"
  ]
}
```

Use a full commit SHA. Do not leave this plugin on a floating branch spec; OpenCode caches plugin installs.

No manual `npm install` step is required. OpenCode installs the GitHub plugin spec at startup.

## Display

The plugin renders immediately after the built-in `Context` sidebar block:

```text
Context + Subagents
128,234 tokens total
+14,823 from 3 subagents
$0.02 total
```

`tokens total` is the current main session context tokens plus current context tokens from all descendant subagent sessions. The token formula matches OpenCode's built-in Context block: input + output + reasoning + cache read + cache write from each session's latest assistant message.

`from N subagents` counts only descendant sessions with non-zero current context tokens.

Cost is the summed session cost for the main session and descendant sessions.

## Behavior

The plugin is a pure TUI plugin. It does not install server hooks, rewrite provider requests, change prompts, or disable built-in sidebar plugins.

It reads session parent links through OpenCode's session API and renders a separate `sidebar_content` block with order `101`, directly after the built-in Context block at order `100`.

If session reads fail, the sidebar shows:

```text
Context + Subagents
subagent total unavailable
```

The plugin retries on later session/message events.

## Manual Verification

Testing on a session with no subagents does not verify the requested behavior. Use or create a session that has at least one subagent before checking the sidebar.

The intended smoke test is:

1. Install the pinned commit in `tui.json`.
2. Restart OpenCode.
3. Resume a tmux/OpenCode session with subagents, or ask the main agent to launch a subagent.
4. Confirm the sidebar shows `Context + Subagents` and a non-zero `from N subagents` line.

## Development

```bash
npm test
npm pack --dry-run
```
