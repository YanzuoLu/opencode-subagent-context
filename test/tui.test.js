import test from "node:test"
import assert from "node:assert/strict"

import plugin, { collectDescendantIDs, computeSidebarState, contextTokensForMessage, createSidebarElement, formatTokenCount } from "../tui.js"

function tokens(input, output, reasoning = 0, read = 0, write = 0) {
  return { input, output, reasoning, cache: { read, write } }
}

function assistant(tokens, providerID = "openai", modelID = "gpt-5.5") {
  return { role: "assistant", providerID, modelID, tokens }
}

function usagePart(totalTokens = 0, subagentTokens = 0, cost = 0, costAvailable = true) {
  return { totalTokens, subagentTokens, cost, costAvailable }
}

function expectedBreakdown(parts = {}) {
  return {
    input: usagePart(),
    output: usagePart(),
    reasoning: usagePart(),
    cacheRead: usagePart(),
    cacheWrite: usagePart(),
    ...parts,
  }
}

function makeApi({ sessions, messages }) {
  const calls = []
  return {
    calls,
    state: {
      path: { directory: "/tmp/workspace", workspace: "workspace-a" },
    },
    client: {
      session: {
        async list(input = {}) {
          calls.push({ method: "list", input })
          return sessions
        },
        async messages(input) {
          calls.push({ method: "messages", input })
          return { data: messages[input.sessionID] ?? [] }
        },
      },
    },
  }
}

function makePaginatedApi({ sessions, messages }) {
  const calls = []
  return {
    calls,
    state: {
      path: { directory: "/tmp/workspace", workspace: "workspace-a" },
    },
    client: {
      session: {
        async list(input = {}) {
          calls.push({ method: "list", input })
          const start = input.start ?? 0
          const limit = input.limit ?? sessions.length
          return sessions.slice(start, start + limit)
        },
        async messages(input) {
          calls.push({ method: "messages", input })
          return { data: messages[input.sessionID] ?? [] }
        },
      },
    },
  }
}

function makeOpenTuiView() {
  return {
    createElement(type) {
      return { type, props: {}, children: [] }
    },
    insert(parent, child) {
      parent.children.push(child)
    },
    setProp(element, key, value) {
      element.props[key] = value
    },
  }
}

function makeTuiApi({ routeSessionID = "root", sessions = [], messages = {} } = {}) {
  const registrations = []
  const renders = []
  return {
    registrations,
    renders,
    route: { current: { name: "session", params: { sessionID: routeSessionID } } },
    state: { path: { directory: "/tmp/workspace", workspace: "workspace-a" } },
    theme: { current: { text: "text", textMuted: "muted" } },
    renderer: {
      requestRender() {
        renders.push(true)
      },
    },
    slots: {
      register(registration) {
        registrations.push(registration)
        return "opencode-subagent-context"
      },
    },
    event: {
      on() {
        return () => {}
      },
    },
    lifecycle: {
      onDispose() {
        return () => {}
      },
    },
    client: {
      session: {
        async list() {
          return sessions
        },
        async messages(input) {
          return { data: messages[input.sessionID] ?? [] }
        },
      },
    },
  }
}

test("contextTokensForMessage matches OpenCode Context token formula", () => {
  assert.equal(contextTokensForMessage({ role: "assistant", tokens: tokens(100, 50, 10, 5, 2) }), 167)
  assert.equal(contextTokensForMessage({ type: "assistant", tokens: tokens(20, 3, 2, 1, 4) }), 30)
  assert.equal(contextTokensForMessage({ info: { role: "assistant", tokens: tokens(7, 3, 2, 1, 1) }, parts: [] }), 14)
  assert.equal(contextTokensForMessage({ role: "user", tokens: tokens(1, 1) }), 0)
  assert.equal(contextTokensForMessage({ role: "assistant", tokens: tokens(100, 0) }), 0)
})

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
    cost: 0,
    costAvailable: false,
    breakdown: expectedBreakdown({
      input: usagePart(121, 21, 0, false),
      output: usagePart(17, 7, 0, false),
      reasoning: usagePart(3, 3, 0, false),
      cacheRead: usagePart(4, 4, 0, false),
      cacheWrite: usagePart(5, 5, 0, false),
    }),
  })
})

test("computeSidebarState always estimates cost from OpenAI token prices", async () => {
  const api = makeApi({
    sessions: [
      { id: "root", cost: 999 },
      { id: "child", parentID: "root", cost: 999 },
    ],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000))],
      child: [assistant(tokens(0, 1_000_000))],
    },
  })

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 2_000_000,
    subagentTokens: 1_000_000,
    totalTokens: 3_000_000,
    subagentCount: 1,
    cost: 65,
    costAvailable: true,
    breakdown: expectedBreakdown({
      input: usagePart(1_000_000, 0, 5),
      output: usagePart(2_000_000, 1_000_000, 60),
    }),
  })
})

test("computeSidebarState accumulates usage across all assistant messages", async () => {
  const api = makeApi({
    sessions: [
      { id: "root", cost: 999 },
      { id: "child", parentID: "root", cost: 999 },
    ],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000)), assistant(tokens(500_000, 500_000))],
      child: [assistant(tokens(0, 1_000_000)), assistant(tokens(250_000, 250_000))],
    },
  })

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 3_000_000,
    subagentTokens: 1_500_000,
    totalTokens: 4_500_000,
    subagentCount: 1,
    cost: 91.25,
    costAvailable: true,
    breakdown: expectedBreakdown({
      input: usagePart(1_750_000, 250_000, 8.75),
      output: usagePart(2_750_000, 1_250_000, 82.5),
    }),
  })
})

test("computeSidebarState marks cost unavailable when a priced message has no model price", async () => {
  const api = makeApi({
    sessions: [{ id: "root", cost: 999 }],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000), "unknown", "missing-model")],
    },
  })

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 2_000_000,
    subagentTokens: 0,
    totalTokens: 2_000_000,
    subagentCount: 0,
    cost: 0,
    costAvailable: false,
    breakdown: expectedBreakdown({
      input: usagePart(1_000_000, 0, 0, false),
      output: usagePart(1_000_000, 0, 0, false),
    }),
  })
})

test("computeSidebarState uses configured prices before built-in prices", async () => {
  const api = makeApi({
    sessions: [{ id: "root", cost: 999 }],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000, 0, 1_000_000))],
    },
  })

  assert.deepEqual(
    await computeSidebarState(api, "root", {
      prices: {
        "openai/gpt-5.5": { input: 1, output: 2, cacheRead: 0.5 },
      },
    }),
    {
      ok: true,
      mainTokens: 3_000_000,
      subagentTokens: 0,
      totalTokens: 3_000_000,
      subagentCount: 0,
      cost: 3.5,
      costAvailable: true,
      breakdown: expectedBreakdown({
        input: usagePart(1_000_000, 0, 1),
        output: usagePart(1_000_000, 0, 2),
        cacheRead: usagePart(1_000_000, 0, 0.5),
      }),
    },
  )
})

test("computeSidebarState treats zero configured category prices as valid", async () => {
  const api = makeApi({
    sessions: [{ id: "root", cost: 999 }],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000))],
    },
  })

  assert.deepEqual(
    await computeSidebarState(api, "root", {
      prices: {
        "openai/gpt-5.5": { input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      },
    }),
    {
      ok: true,
      mainTokens: 5_000_000,
      subagentTokens: 0,
      totalTokens: 5_000_000,
      subagentCount: 0,
      cost: 3,
      costAvailable: true,
      breakdown: expectedBreakdown({
        input: usagePart(1_000_000, 0, 1),
        output: usagePart(1_000_000, 0, 2),
        reasoning: usagePart(1_000_000, 0, 0),
        cacheRead: usagePart(1_000_000, 0, 0),
        cacheWrite: usagePart(1_000_000, 0, 0),
      }),
    },
  )
})

test("computeSidebarState reports per-category total and subagent usage with costs", async () => {
  const api = makeApi({
    sessions: [
      { id: "root", cost: 999 },
      { id: "child", parentID: "root", cost: 999 },
    ],
    messages: {
      root: [assistant(tokens(1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000))],
      child: [assistant(tokens(100_000, 200_000, 300_000, 400_000, 500_000))],
    },
  })

  const state = await computeSidebarState(api, "root", {
    prices: {
      "openai/gpt-5.5": { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 },
    },
  })

  assert.deepEqual(state.breakdown, {
    input: { totalTokens: 1_100_000, subagentTokens: 100_000, cost: 1.1, costAvailable: true },
    output: { totalTokens: 2_200_000, subagentTokens: 200_000, cost: 4.4, costAvailable: true },
    reasoning: { totalTokens: 3_300_000, subagentTokens: 300_000, cost: 9.9, costAvailable: true },
    cacheRead: { totalTokens: 4_400_000, subagentTokens: 400_000, cost: 17.6, costAvailable: true },
    cacheWrite: { totalTokens: 5_500_000, subagentTokens: 500_000, cost: 27.5, costAvailable: true },
  })
})

test("collectDescendantIDs ignores cycles without returning the root", () => {
  const sessions = [
    { id: "root", parentID: "child" },
    { id: "child", parentID: "root" },
  ]

  assert.deepEqual(collectDescendantIDs(sessions, "root"), ["child"])
})

test("computeSidebarState returns zero subagent contribution when there are no descendants", async () => {
  const api = makeApi({
    sessions: [{ id: "root", cost: 0.01 }],
    messages: { root: [{ role: "assistant", tokens: tokens(100, 10) }] },
  })

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 110,
    subagentTokens: 0,
    totalTokens: 110,
    subagentCount: 0,
    cost: 0,
    costAvailable: false,
    breakdown: expectedBreakdown({
      input: usagePart(100, 0, 0, false),
      output: usagePart(10, 0, 0, false),
    }),
  })
})

test("computeSidebarState returns unavailable state instead of throwing on API failure", async () => {
  const api = {
    state: { path: { directory: "/tmp/workspace" } },
    client: {
      session: {
        async list() {
          throw new Error("boom")
        },
      },
    },
  }

  const state = await computeSidebarState(api, "root")

  assert.equal(state.ok, false)
  assert.match(String(state.error?.message), /boom/)
})

test("computeSidebarState scans paginated session lists before collecting descendants", async () => {
  const api = makePaginatedApi({
    sessions: [
      { id: "root", cost: 0.01 },
      { id: "child", parentID: "root", cost: 0.02 },
    ],
    messages: {
      root: [{ role: "assistant", tokens: tokens(100, 10) }],
      child: [{ role: "assistant", tokens: tokens(20, 5) }],
    },
  })

  assert.deepEqual(await computeSidebarState(api, "root", { listLimit: 1 }), {
    ok: true,
    mainTokens: 110,
    subagentTokens: 25,
    totalTokens: 135,
    subagentCount: 1,
    cost: 0,
    costAvailable: false,
    breakdown: expectedBreakdown({
      input: usagePart(120, 20, 0, false),
      output: usagePart(15, 5, 0, false),
    }),
  })
  assert.deepEqual(
    api.calls.filter((call) => call.method === "list").map((call) => call.input.start),
    [0, 1, 2],
  )
})

test("computeSidebarState walks session.children when available", async () => {
  const calls = []
  const api = {
    calls,
    state: { path: { directory: "/tmp/workspace", workspace: "workspace-a" } },
    client: {
      session: {
        async list() {
          throw new Error("session.list should not be called")
        },
        async get(input) {
          calls.push({ method: "get", input })
          return { data: { id: input.sessionID, cost: 0.01 } }
        },
        async children(input) {
          calls.push({ method: "children", input })
          return {
            data:
              {
                root: [{ id: "child", cost: 0.02 }],
                child: [{ id: "grandchild", cost: 0.03 }],
                grandchild: [],
              }[input.sessionID] ?? [],
          }
        },
        async messages(input) {
          calls.push({ method: "messages", input })
          return {
            data:
              {
                root: [{ role: "assistant", tokens: tokens(100, 10) }],
                child: [{ role: "assistant", tokens: tokens(20, 5) }],
                grandchild: [{ role: "assistant", tokens: tokens(1, 2) }],
              }[input.sessionID] ?? [],
          }
        },
      },
    },
  }

  assert.deepEqual(await computeSidebarState(api, "root"), {
    ok: true,
    mainTokens: 110,
    subagentTokens: 28,
    totalTokens: 138,
    subagentCount: 2,
    cost: 0,
    costAvailable: false,
    breakdown: expectedBreakdown({
      input: usagePart(121, 21, 0, false),
      output: usagePart(17, 7, 0, false),
    }),
  })
  assert.deepEqual(
    calls.filter((call) => call.method === "children").map((call) => call.input.sessionID),
    ["root", "child", "grandchild"],
  )
})

test("default export is a target-exclusive TUI plugin module", () => {
  assert.equal(plugin.id, "opencode-subagent-context")
  assert.equal(typeof plugin.tui, "function")
  assert.equal(plugin.server, undefined)
})

test("createSidebarElement renders total and subagent contribution", () => {
  const rendered = createSidebarElement(
    { theme: { current: { text: "text", textMuted: "muted" } } },
    {
      ok: true,
      totalTokens: 128234,
      subagentTokens: 14823,
      subagentCount: 3,
      cost: 0.47,
      costAvailable: true,
      breakdown: {
        input: { totalTokens: 53770, subagentTokens: 1000, cost: 0.27, costAvailable: true },
        output: { totalTokens: 1817, subagentTokens: 200, cost: 0.05, costAvailable: true },
        reasoning: { totalTokens: 2295, subagentTokens: 300, cost: 0.07, costAvailable: true },
        cacheRead: { totalTokens: 146944, subagentTokens: 13323, cost: 0.07, costAvailable: true },
        cacheWrite: { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true },
      },
    },
    makeOpenTuiView(),
  )

  assert.deepEqual(rendered, {
    type: "box",
    props: { width: "100%", flexDirection: "column" },
    children: [
      { type: "text", props: { fg: "text" }, children: ["Usage"] },
      { type: "text", props: { fg: "muted" }, children: ["128.2K tokens used total"] },
      { type: "text", props: { fg: "muted" }, children: ["+14.8K used by 3 subagents"] },
      { type: "text", props: { fg: "muted" }, children: ["$0.47 spent total"] },
      { type: "text", props: { fg: "muted" }, children: ["in 53.8K (+1.0K) / $0.27"] },
      { type: "text", props: { fg: "muted" }, children: ["out 1.8K (+200) / $0.05"] },
      { type: "text", props: { fg: "muted" }, children: ["rsn 2.3K (+300) / $0.07"] },
      { type: "text", props: { fg: "muted" }, children: ["cache 146.9K (+13.3K) / $0.07"] },
      { type: "text", props: { fg: "muted" }, children: ["write 0 (+0) / $0.00"] },
    ],
  })
})

test("createSidebarElement renders unavailable state without throwing", () => {
  const rendered = createSidebarElement(
    { theme: { current: { text: "text", textMuted: "muted" } } },
    { ok: false, error: new Error("boom") },
    makeOpenTuiView(),
  )

  assert.equal(rendered.children[0].children[0], "Usage")
  assert.equal(rendered.children[1].children[0], "subagent total unavailable")
})

test("createSidebarElement renders API cost unavailable for missing model prices", () => {
  const rendered = createSidebarElement(
    { theme: { current: { text: "text", textMuted: "muted" } } },
    { ok: true, totalTokens: 128234, subagentTokens: 14823, subagentCount: 3, cost: 0, costAvailable: false },
    makeOpenTuiView(),
  )

  assert.equal(rendered.children[3].children[0], "API cost unavailable")
})

test("createSidebarElement renders unavailable breakdown costs", () => {
  const rendered = createSidebarElement(
    { theme: { current: { text: "text", textMuted: "muted" } } },
    {
      ok: true,
      totalTokens: 1817,
      subagentTokens: 0,
      subagentCount: 0,
      cost: 0,
      costAvailable: false,
      breakdown: {
        input: { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true },
        output: { totalTokens: 1817, subagentTokens: 0, cost: 0, costAvailable: false },
        reasoning: { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true },
        cacheRead: { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true },
        cacheWrite: { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true },
      },
    },
    makeOpenTuiView(),
  )

  assert.equal(rendered.children[5].children[0], "out 1.8K (+0) / unavailable")
})

test("tui registers sidebar_content immediately after built-in Context", async () => {
  const api = makeTuiApi()

  await plugin.tui(api, undefined, undefined, { view: makeOpenTuiView(), initialState: { ok: false } })

  assert.equal(api.registrations.length, 1)
  assert.equal(api.registrations[0].order, 101)
  assert.equal(typeof api.registrations[0].slots.sidebar_content, "function")

  const rendered = api.registrations[0].slots.sidebar_content({}, { session_id: "root" })
  assert.equal(rendered.children[0].children[0], "Usage")
})

test("tui refreshes from current route when slot props omit session_id", async () => {
  const api = makeTuiApi({
    routeSessionID: "root",
    sessions: [
      { id: "root", cost: 0.01 },
      { id: "child", parentID: "root", cost: 0.02 },
    ],
    messages: {
      root: [{ role: "assistant", tokens: tokens(100, 10) }],
      child: [{ role: "assistant", tokens: tokens(20, 5) }],
    },
  })

  await plugin.tui(api, undefined, undefined, { view: makeOpenTuiView(), refreshDebounceMs: 0 })
  const slot = api.registrations[0].slots.sidebar_content

  slot({}, {})
  await new Promise((resolve) => setTimeout(resolve, 10))
  const rendered = slot({}, {})

  assert.equal(rendered.children[1].children[0], "135 tokens used total")
  assert.equal(rendered.children[2].children[0], "+25 used by 1 subagent")
  assert.equal(api.renders.length > 0, true)
})

test("tui passes plugin price options to sidebar state calculation", async () => {
  const api = makeTuiApi({
    routeSessionID: "root",
    sessions: [{ id: "root", cost: 999 }],
    messages: {
      root: [assistant(tokens(1_000_000, 1_000_000))],
    },
  })

  await plugin.tui(
    api,
    { prices: { "openai/gpt-5.5": { input: 1, output: 2 } } },
    undefined,
    { view: makeOpenTuiView(), refreshDebounceMs: 0 },
  )
  const slot = api.registrations[0].slots.sidebar_content

  slot({}, {})
  await new Promise((resolve) => setTimeout(resolve, 10))
  const rendered = slot({}, {})

  assert.equal(rendered.children[3].children[0], "$3.00 spent total")
})
