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

Cost is estimated API-equivalent cost for the current main session plus descendant subagent contexts. It is always calculated from the latest assistant message token usage and the plugin price table; OpenCode's session-level `cost` field is not used.

If any relevant model has token usage but no configured price, the cost line shows:

```text
API cost unavailable
```

Built-in OpenAI prices are per 1M tokens and currently include:

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `openai/gpt-5.5` | `$5.00` | `$0.50` | `$30.00` |
| `openai/gpt-5.5-pro` | `$30.00` | `$30.00` | `$180.00` |
| `openai/gpt-5.4` | `$2.50` | `$0.25` | `$15.00` |
| `openai/gpt-5.4-mini` | `$0.75` | `$0.075` | `$4.50` |

Override or add prices in `tui.json` with plugin tuple options:

```json
{
  "plugin": [
    [
      "opencode-subagent-context@git+https://github.com/YanzuoLu/opencode-subagent-context.git#<full-commit-sha>",
      {
        "prices": {
          "openai/custom-model": {
            "input": 1.25,
            "output": 10,
            "cacheRead": 0.125,
            "cacheWrite": 1.25,
            "reasoning": 10
          }
        }
      }
    ]
  ]
}
```

`reasoning` defaults to the output price. `cacheRead` and `cacheWrite` default to the input price when omitted.

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
