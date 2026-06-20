import test from "node:test"
import assert from "node:assert/strict"

import plugin, { collectDescendantIDs, computeSidebarState, contextTokensForMessage, createSidebarElement } from "../tui.js"

function tokens(input, output, reasoning = 0, read = 0, write = 0) {
  return { input, output, reasoning, cache: { read, write } }
}

function assistant(tokens, providerID = "openai", modelID = "gpt-5.5") {
  return { role: "assistant", providerID, modelID, tokens }
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
    },
  )
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
    { ok: true, totalTokens: 128234, subagentTokens: 14823, subagentCount: 3, cost: 0.02, costAvailable: true },
    makeOpenTuiView(),
  )

  assert.deepEqual(rendered, {
    type: "box",
    props: { width: "100%", flexDirection: "column" },
    children: [
      { type: "text", props: { fg: "text" }, children: ["Context + Subagents"] },
      { type: "text", props: { fg: "muted" }, children: ["128,234 tokens total"] },
      { type: "text", props: { fg: "muted" }, children: ["+14,823 from 3 subagents"] },
      { type: "text", props: { fg: "muted" }, children: ["$0.02 total"] },
    ],
  })
})

test("createSidebarElement renders unavailable state without throwing", () => {
  const rendered = createSidebarElement(
    { theme: { current: { text: "text", textMuted: "muted" } } },
    { ok: false, error: new Error("boom") },
    makeOpenTuiView(),
  )

  assert.equal(rendered.children[0].children[0], "Context + Subagents")
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

test("tui registers sidebar_content immediately after built-in Context", async () => {
  const api = makeTuiApi()

  await plugin.tui(api, undefined, undefined, { view: makeOpenTuiView(), initialState: { ok: false } })

  assert.equal(api.registrations.length, 1)
  assert.equal(api.registrations[0].order, 101)
  assert.equal(typeof api.registrations[0].slots.sidebar_content, "function")

  const rendered = api.registrations[0].slots.sidebar_content({}, { session_id: "root" })
  assert.equal(rendered.children[0].children[0], "Context + Subagents")
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

  assert.equal(rendered.children[1].children[0], "135 tokens total")
  assert.equal(rendered.children[2].children[0], "+25 from 1 subagent")
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

  assert.equal(rendered.children[3].children[0], "$3.00 total")
})
