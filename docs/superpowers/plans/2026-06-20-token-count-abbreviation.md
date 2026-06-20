# Token Count Abbreviation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abbreviate long token counts in the OpenCode TUI sidebar with one decimal place and `K/M/B/T` suffixes while leaving cost display unchanged.

**Architecture:** Keep `tui.js` as the single plugin module. Add one exported `formatTokenCount(value)` helper and use it only at render boundaries so aggregation and cost math stay unchanged.

**Tech Stack:** Node.js ESM, `node:test`, OpenCode TUI plugin API, OpenTUI Solid runtime.

## Global Constraints

- Only token count display changes.
- The underlying usage aggregation, cost calculation, session discovery, and plugin registration stay unchanged.
- Values below `1,000` render as plain integers with locale separators when applicable: `0`, `485`, `999`.
- Values from `1,000` upward render with one decimal place and a suffix.
- Suffixes are `K`, `M`, `B`, and `T` for thousand, million, billion, and trillion.
- Values above the trillion range keep using `T` as the largest suffix, for example `1,000.0T`; do not add `P` or `E` suffixes.
- Keep the trailing decimal digit: `1,000` renders as `1.0K`, not `1K`.
- Use stable `en-US` separators for abbreviated token counts so the decimal separator is always `.` regardless of the user's system locale.
- Preserve the existing `+` prefix where the UI already shows subagent contribution.
- Cost display is unchanged.
- Do not abbreviate dollar amounts.
- Do not add user configuration for abbreviation thresholds.
- Do not change sidebar order, plugin targets, or external plugin behavior.

---

## File Structure

- Modify `tui.js`: add `formatTokenCount(value)` and replace token-only `toLocaleString()` calls inside `createSidebarElement`.
- Modify `test/tui.test.js`: add formatter unit tests and update render expectations for abbreviated token counts.
- Modify `README.md`: document abbreviated token examples.
- Modify `package.json`: bump version only if preparing a release.

### Task 1: Add Token Formatter RED Tests

**Files:**
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes future export: `formatTokenCount(value: number): string` from `../tui.js`.
- Produces tests that define exact threshold behavior for display code.

- [ ] **Step 1: Import the future formatter**

Change the import to include `formatTokenCount`:

```js
import plugin, { collectDescendantIDs, computeSidebarState, contextTokensForMessage, createSidebarElement, formatTokenCount } from "../tui.js"
```

- [ ] **Step 2: Add failing formatter test**

Add this test near the existing token formula test:

```js
test("formatTokenCount abbreviates long token counts", () => {
  assert.equal(formatTokenCount(0), "0")
  assert.equal(formatTokenCount(485), "485")
  assert.equal(formatTokenCount(999), "999")
  assert.equal(formatTokenCount(1_000), "1.0K")
  assert.equal(formatTokenCount(19_515), "19.5K")
  assert.equal(formatTokenCount(1_234_567), "1.2M")
  assert.equal(formatTokenCount(1_234_567_890), "1.2B")
  assert.equal(formatTokenCount(1_234_567_890_123), "1.2T")
  assert.equal(formatTokenCount(1_234_567_890_123_000), "1,234.6T")
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because `formatTokenCount` is not exported.

### Task 2: Implement Formatter

**Files:**
- Modify: `tui.js`

**Interfaces:**
- Produces: `formatTokenCount(value: number): string`.

- [ ] **Step 1: Add minimal implementation**

Add this helper near the existing `money` formatter:

```js
export function formatTokenCount(value) {
  const number = numberOrZero(value)
  if (number < 1_000) return number.toLocaleString("en-US")

  const suffixes = ["K", "M", "B", "T"]
  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  let scaled = number / 1_000
  let suffixIndex = 0
  while (scaled >= 1_000 && suffixIndex < suffixes.length - 1) {
    scaled /= 1_000
    suffixIndex += 1
  }
  return `${formatter.format(scaled)}${suffixes[suffixIndex]}`
}
```

- [ ] **Step 2: Run formatter tests**

Run: `npm test`

Expected: formatter test PASS; render tests still use old comma expectations until Task 3 updates them.

### Task 3: Apply Formatter to Sidebar Rendering

**Files:**
- Modify: `tui.js`
- Modify: `test/tui.test.js`

**Interfaces:**
- Consumes: `formatTokenCount(value)` from Task 2.
- Produces: abbreviated token output in `createSidebarElement`.

- [ ] **Step 1: Write failing render expectations**

Update render tests to expect:

```text
128.2K tokens used total
+14.8K used by 3 subagents
in 53.8K (+1.0K) / $0.27
out 1.8K (+200) / $0.05
rsn 2.3K (+300) / $0.07
cache 146.9K (+13.3K) / $0.07
write 0 (+0) / $0.00
```

Update the route refresh test to keep `135 tokens used total` and `+25 used by 1 subagent`, proving small values stay unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL because rendering still uses `toLocaleString()`.

- [ ] **Step 3: Replace rendering calls**

In `createSidebarElement`, replace token-only `toLocaleString()` calls with `formatTokenCount(...)`:

```js
lines.push(textNode(`${formatTokenCount(state.totalTokens ?? 0)} tokens used total`, { fg: theme.textMuted }, view))
lines.push(
  textNode(`+${formatTokenCount(state.subagentTokens ?? 0)} used by ${subagentCount} ${pluralSubagent(subagentCount)}`, { fg: theme.textMuted }, view),
)
```

For breakdown lines:

```js
`${category.label} ${formatTokenCount(part.totalTokens ?? 0)} (+${formatTokenCount(part.subagentTokens ?? 0)}) / ${cost}`
```

- [ ] **Step 4: Run tests**

Run: `npm test`

Expected: all tests PASS.

### Task 4: Update Documentation and Verify Package

**Files:**
- Modify: `README.md`
- Modify: `package.json` only if a release is authorized.

**Interfaces:**
- Consumes: display behavior from Tasks 2 and 3.

- [ ] **Step 1: Update README display example**

Change long token examples to abbreviated form:

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

Add one sentence: `Token counts below 1,000 remain unabridged; longer counts use one decimal place with K/M/B/T suffixes.`

- [ ] **Step 2: Run local verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm pack --dry-run`

Expected: package contains only `LICENSE`, `README.md`, `package.json`, `tui.js`.

- [ ] **Step 3: Stop before release unless authorized**

If the user has not explicitly authorized commit/push/release, report local verification results and ask whether to release and update global `~/.config/opencode/tui.json`.

## Self-Review

- Spec coverage: all display rules, affected lines, non-goals, and tests map to tasks.
- Placeholder scan: no placeholder text remains.
- Type consistency: `formatTokenCount(value)` is the single helper name used in tests and implementation.
