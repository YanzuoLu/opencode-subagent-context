# API-Equivalent Cost Design

## Goal

Show estimated API-equivalent cost in the `Context + Subagents` sidebar block even when OpenCode's OpenAI provider session cost is zero because usage comes from a subscription-style path.

## Behavior

The plugin always computes cost from model pricing and latest assistant-message token usage. It never uses OpenCode session-level `cost` for display.

For the main session and every descendant subagent session:

- Read the latest assistant message with non-zero output tokens.
- Compute current-context tokens exactly as before for the token lines.
- Compute estimated API cost from that same latest assistant message.
- Sum all per-session estimated costs for the displayed total.

If any relevant session has non-zero current-context tokens but its model price is missing, the cost line shows `API cost unavailable` instead of `$0.00 total`.

## Pricing Model

Prices are per 1M tokens and keyed by `providerID/modelID` after lowercasing. The initial built-in table covers OpenAI models documented on OpenAI's public pricing pages:

- `openai/gpt-5.5`: input `5.00`, cached input `0.50`, output `30.00`
- `openai/gpt-5.5-pro`: input `30.00`, output `180.00`
- `openai/gpt-5.4`: input `2.50`, cached input `0.25`, output `15.00`
- `openai/gpt-5.4-mini`: input `0.75`, cached input `0.075`, output `4.50`

The table can be extended without changing code through TUI plugin options:

```json
[
  "opencode-subagent-context@git+https://github.com/YanzuoLu/opencode-subagent-context.git#<full-sha>",
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
```

`reasoning` defaults to the output price. `cacheRead` defaults to the input price when omitted. `cacheWrite` defaults to the input price when omitted. All values are per 1M tokens.

## Display

When all relevant prices exist:

```text
Context + Subagents
19,011 tokens total
+8,004 from 1 subagent
$0.09 total
```

When at least one relevant priced message is missing a price:

```text
Context + Subagents
19,011 tokens total
+8,004 from 1 subagent
API cost unavailable
```

The cost label in README is described as estimated API-equivalent cost, not OpenCode billing cost.

## Error Handling

Missing prices do not make the whole sidebar unavailable. They only make the cost line unavailable. API read failures keep the existing `subagent total unavailable` behavior.

## Verification

Use the same loop as the previous release:

1. Add failing unit tests for API-equivalent cost behavior.
2. Implement the minimal fix.
3. Run `npm test` and `npm pack --dry-run`.
4. Commit, push, and create a GitHub release.
5. Update global `~/.config/opencode/tui.json` to the full pinned commit SHA.
6. Restart OpenCode in tmux and verify a session with a real subagent shows a non-zero estimated cost or `API cost unavailable` only when expected.

## Sources

- OpenAI API pricing: https://openai.com/api/pricing
- OpenAI GPT-5.5 announcement: https://openai.com/index/introducing-gpt-5-5/
