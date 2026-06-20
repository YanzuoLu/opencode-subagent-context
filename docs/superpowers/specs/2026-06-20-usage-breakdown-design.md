# Usage Breakdown Sidebar Design

## Goal

Add per-token-category usage and cost breakdown lines to the existing cumulative usage sidebar block.

## Display

The title changes from `Usage + Subagents` to `Usage`.

The existing first three metric lines stay semantically the same:

```text
Usage
204,826 tokens used total
+0 used by 0 subagents
$0.47 spent total
```

Below them, render five breakdown lines:

```text
in 53,770 (+0) / $0.27
out 1,817 (+0) / $0.05
rsn 2,295 (+0) / $0.07
cache 146,944 (+0) / $0.07
write 0 (+0) / $0.00
```

Breakdown labels mean:

- `in`: `tokens.input`
- `out`: `tokens.output`
- `rsn`: `tokens.reasoning`
- `cache`: `tokens.cache.read`
- `write`: `tokens.cache.write`

Each line uses this format:

```text
<label> <total tokens> (+<subagent tokens>) / <total cost>
```

The cost is main plus subagents combined for that category. The cost inside parentheses is not shown.

## Cost Rules

Use the existing price table and override mechanism:

- `in` uses `price.input`.
- `out` uses `price.output`.
- `rsn` uses `price.reasoning`, defaulting to `price.output`.
- `cache` uses `price.cacheRead`, defaulting to `price.input`.
- `write` uses `price.cacheWrite`, defaulting to `price.input`.

If a category has non-zero tokens for a message and that message lacks a valid model price, that category's cost becomes unavailable.

If any included message lacks a valid model price, the total cost line remains `API cost unavailable`.

If a breakdown category cost is unavailable, the category line renders `unavailable` instead of a dollar amount:

```text
out 1,817 (+0) / unavailable
```

Token counts still render even when cost is unavailable.

## Data Model

Extend sidebar state with a `breakdown` object keyed by category:

```js
{
  input: { totalTokens, subagentTokens, cost, costAvailable },
  output: { totalTokens, subagentTokens, cost, costAvailable },
  reasoning: { totalTokens, subagentTokens, cost, costAvailable },
  cacheRead: { totalTokens, subagentTokens, cost, costAvailable },
  cacheWrite: { totalTokens, subagentTokens, cost, costAvailable }
}
```

Existing `mainTokens`, `subagentTokens`, `totalTokens`, `cost`, and `costAvailable` remain for the top three lines.

## Verification

Use the release loop from prior versions:

1. Write RED tests for breakdown aggregation and rendering.
2. Implement the minimal state and renderer changes.
3. Run `npm test` and `npm pack --dry-run`.
4. Commit, push, and create a GitHub release.
5. Update global `~/.config/opencode/tui.json` to the full pinned commit SHA.
6. Restart OpenCode in a real tmux smoke session with a subagent and verify all breakdown lines render.
