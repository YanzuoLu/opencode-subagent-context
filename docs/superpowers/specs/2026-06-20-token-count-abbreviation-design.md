# Token Count Abbreviation Design

## Goal

Shorten long token counts in the OpenCode TUI sidebar while keeping the existing cumulative usage layout and cost formatting.

## Scope

Only token count display changes. The underlying usage aggregation, cost calculation, session discovery, and plugin registration stay unchanged.

## Display Rules

Format every token count rendered by the plugin with a shared helper:

- Values below `1,000` render as plain integers with locale separators when applicable: `0`, `485`, `999`.
- Values from `1,000` upward render with one decimal place and a suffix.
- Suffixes are `K`, `M`, `B`, and `T` for thousand, million, billion, and trillion.
- Values above the trillion range keep using `T` as the largest suffix, for example `1,000.0T`; do not add `P` or `E` suffixes.
- Keep the trailing decimal digit: `1,000` renders as `1.0K`, not `1K`.
- Use stable `en-US` separators for abbreviated token counts so the decimal separator is always `.` regardless of the user's system locale.
- Preserve the existing `+` prefix where the UI already shows subagent contribution.

Examples:

```text
38,405 tokens used total       -> 38.4K tokens used total
+16,064 used by 1 subagent     -> +16.1K used by 1 subagent
in 19,515 (+8,149) / $0.10     -> in 19.5K (+8.1K) / $0.10
out 485 (+216) / $0.01         -> out 485 (+216) / $0.01
write 0 (+0) / $0.00           -> write 0 (+0) / $0.00
```

## Cost Formatting

Cost display is unchanged:

- Total cost continues to render with `Intl.NumberFormat` currency formatting, such as `$0.15 spent total`.
- Breakdown category costs continue to render as currency, such as `/ $0.10`.
- Unavailable costs continue to render as `API cost unavailable` or `/ unavailable`.

## Affected Lines

Apply the token formatter to:

- The total usage line: `<tokens> tokens used total`.
- The subagent contribution line: `+<tokens> used by N subagent(s)`.
- Each breakdown total token count.
- Each breakdown subagent token count inside parentheses.

## Testing

Add unit coverage for:

- Formatting below `1,000` as unchanged integers.
- Formatting `K`, `M`, `B`, and `T` thresholds with one decimal place.
- Rendering top-level total and subagent lines with abbreviated token counts.
- Rendering breakdown lines with abbreviated total and parenthesized subagent token counts.
- Preserving money formatting and unavailable cost behavior.

## Non-Goals

- Do not abbreviate dollar amounts.
- Do not add user configuration for abbreviation thresholds.
- Do not change aggregation semantics or cost math.
- Do not change sidebar order, plugin targets, or external plugin behavior.
