# opencode-subagent-context

Show OpenCode main-agent usage plus subagent usage and cost breakdown in the TUI sidebar.

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
Usage
128.2K tokens used total
+14.8K used by 3 subagents
$0.47 spent total
in 53.8K (+1.0K) / $0.27
out 1.8K (+200) / $0.05
rsn 2.3K (+300) / $0.07
cache 146.9K (+13.3K) / $0.07
write 0 (+0) / $0.00
```

`tokens used total` is cumulative token usage for the main session plus all descendant subagent sessions. It sums every assistant message with non-zero output tokens returned by OpenCode's session API. Each message uses the same token formula as OpenCode's built-in Context block: input + output + reasoning + cache read + cache write.

`used by N subagents` counts only descendant sessions with non-zero cumulative usage.

Cost is cumulative estimated API-equivalent spend for the main session plus descendant subagent sessions. It is always calculated from assistant message token usage and the plugin price table; OpenCode's session-level `cost` field is not used.

Breakdown lines show total tokens, subagent tokens in parentheses, and total estimated cost for that token category. `in` is input tokens, `out` is output tokens, `rsn` is reasoning tokens, `cache` is cached input read tokens, and `write` is cache write tokens.

Token counts below 1,000 remain unabridged. Longer counts use one decimal place with `K`, `M`, `B`, or `T` suffixes.

Auto compaction should not make this plugin's token total go down. If OpenCode records compaction or summary generation as assistant messages with token usage, those messages are included in the cumulative total and cumulative spend.

If any relevant model has token usage but no configured price, the cost line shows:

```text
API cost unavailable
```

If only a breakdown category cost is unavailable, that category keeps its token counts and shows `unavailable` as the category cost.

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
Usage
subagent total unavailable
```

The plugin retries on later session/message events.

## Manual Verification

Testing on a session with no subagents does not verify the requested behavior. Use or create a session that has at least one subagent before checking the sidebar.

The intended smoke test is:

1. Install the pinned commit in `tui.json`.
2. Restart OpenCode.
3. Resume a tmux/OpenCode session with subagents, or ask the main agent to launch a subagent.
4. Confirm the sidebar shows `Usage`, the preserved total/subagent/spend lines, and the `in`, `out`, `rsn`, `cache`, and `write` breakdown lines.

## Development

```bash
npm test
npm pack --dry-run
```
