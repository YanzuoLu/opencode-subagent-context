const SERVICE = "opencode-subagent-context"
const DEFAULT_LIST_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 50
const REFRESH_DEBOUNCE_MS = 100
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})
const REFRESH_EVENTS = ["session.created", "session.updated", "session.deleted", "message.updated", "session.next.step.ended"]

function readData(result) {
  return result && typeof result === "object" && "data" in result ? result.data : result
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function isAssistantMessage(message) {
  return message?.role === "assistant" || message?.type === "assistant"
}

export function contextTokensForMessage(message) {
  const info = message?.info ?? message
  if (!isAssistantMessage(info)) return 0
  const tokens = info?.tokens
  if (!tokens || numberOrZero(tokens.output) <= 0) return 0
  return (
    numberOrZero(tokens.input) +
    numberOrZero(tokens.output) +
    numberOrZero(tokens.reasoning) +
    numberOrZero(tokens.cache?.read) +
    numberOrZero(tokens.cache?.write)
  )
}

export function collectDescendantIDs(sessions, rootID) {
  const children = new Map()
  for (const session of sessions) {
    if (!session?.id || !session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session.id)
    children.set(session.parentID, list)
  }

  const result = []
  const seen = new Set([rootID])
  const queue = [...(children.get(rootID) ?? [])]
  while (queue.length) {
    const id = queue.shift()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    queue.push(...(children.get(id) ?? []))
  }
  return result
}

function sessionClient(api) {
  return api.client?.session ?? api.client?.v2?.session
}

function pathOptions(api) {
  const path = api.state?.path ?? {}
  return {
    directory: path.directory,
    workspace: path.workspace ?? path.workspaceID,
  }
}

async function listSessions(api, options) {
  const client = sessionClient(api)
  if (typeof client?.list !== "function") throw new Error(`${SERVICE}: session.list is unavailable`)
  const limit = options.listLimit ?? DEFAULT_LIST_LIMIT
  const sessions = []
  let start = 0
  while (true) {
    const page = readData(
      await client.list({
        ...pathOptions(api),
        scope: "project",
        roots: false,
        limit,
        start,
      }),
    )
    if (!Array.isArray(page)) return sessions
    sessions.push(...page)
    if (page.length < limit) return sessions
    start += page.length
  }
}

async function readSessionChildren(api, sessionID) {
  const client = sessionClient(api)
  if (typeof client?.children !== "function") return undefined
  const output = await client.children({
    ...pathOptions(api),
    sessionID,
  })
  const children = readData(output)
  return Array.isArray(children) ? children : []
}

async function readSession(api, sessionID) {
  const client = sessionClient(api)
  if (typeof client?.get !== "function") return undefined
  const session = readData(
    await client.get({
      ...pathOptions(api),
      sessionID,
    }),
  )
  return session && typeof session === "object" ? session : undefined
}

async function collectDescendantsFromChildren(api, rootID) {
  const result = []
  const byID = new Map()
  const seen = new Set([rootID])
  const queue = [rootID]
  const root = await readSession(api, rootID)
  if (root) byID.set(root.id ?? rootID, root)

  while (queue.length) {
    const parentID = queue.shift()
    const children = await readSessionChildren(api, parentID)
    if (!children) return undefined
    for (const child of children) {
      if (!child?.id || seen.has(child.id)) continue
      seen.add(child.id)
      byID.set(child.id, child)
      result.push(child.id)
      queue.push(child.id)
    }
  }

  return { descendants: result, byID }
}

async function readSessionMessages(api, sessionID, options) {
  const client = sessionClient(api)
  if (typeof client?.messages !== "function") throw new Error(`${SERVICE}: session.messages is unavailable`)
  const output = await client.messages({
    ...pathOptions(api),
    sessionID,
    limit: options.messageLimit ?? DEFAULT_MESSAGE_LIMIT,
  })
  return readData(output) ?? []
}

async function latestContextTokens(api, sessionID, options) {
  const messages = await readSessionMessages(api, sessionID, options)
  for (let index = messages.length - 1; index >= 0; index--) {
    const tokens = contextTokensForMessage(messages[index])
    if (tokens > 0) return tokens
  }
  return 0
}

export async function computeSidebarState(api, sessionID, options = {}) {
  try {
    const childTree = await collectDescendantsFromChildren(api, sessionID)
    const sessions = childTree ? [] : await listSessions(api, options)
    const descendants = childTree?.descendants ?? collectDescendantIDs(sessions, sessionID)
    const byID = childTree?.byID ?? new Map(sessions.map((session) => [session.id, session]))
    const allIDs = [sessionID, ...descendants]
    let mainTokens = 0
    let subagentTokens = 0
    let subagentCount = 0
    let cost = 0

    for (const id of allIDs) {
      const tokens = await latestContextTokens(api, id, options)
      cost += numberOrZero(byID.get(id)?.cost)
      if (id === sessionID) {
        mainTokens = tokens
        continue
      }
      subagentTokens += tokens
      if (tokens > 0) subagentCount += 1
    }

    return {
      ok: true,
      mainTokens,
      subagentTokens,
      totalTokens: mainTokens + subagentTokens,
      subagentCount,
      cost,
    }
  } catch (error) {
    return {
      ok: false,
      error,
    }
  }
}

let defaultSolidView

async function loadSolidView() {
  if (defaultSolidView) return defaultSolidView
  let solid
  let solidJs
  if (typeof Bun !== "undefined") {
    await import("@opentui/solid/runtime-plugin-support")
    solid = await import("opentui:runtime-module:%40opentui%2Fsolid")
    solidJs = await import("opentui:runtime-module:solid-js")
  } else {
    solid = await import("@opentui/solid")
    solidJs = await import("solid-js")
  }
  const { createElement, insert, setProp } = solid
  const { createSignal } = solidJs
  defaultSolidView = { createElement, createSignal, insert, setProp }
  return defaultSolidView
}

function elementNode(type, props = {}, children = [], view = defaultSolidView) {
  const element = view.createElement(type)
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) view.setProp(element, key, value)
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) view.insert(element, child)
  }
  return element
}

function textNode(value, props = {}, view = defaultSolidView) {
  return elementNode("text", props, [value], view)
}

function themeFor(api) {
  return api.theme?.current ?? api.theme ?? {}
}

function pluralSubagent(count) {
  return count === 1 ? "subagent" : "subagents"
}

export function createSidebarElement(api, state, view = defaultSolidView) {
  if (!view) throw new Error(`${SERVICE}: TUI runtime is not initialized`)
  const theme = themeFor(api)
  const lines = [textNode("Context + Subagents", { fg: theme.text }, view)]

  if (!state?.ok) {
    lines.push(textNode("subagent total unavailable", { fg: theme.textMuted }, view))
  } else {
    const subagentCount = state.subagentCount ?? 0
    lines.push(textNode(`${(state.totalTokens ?? 0).toLocaleString()} tokens total`, { fg: theme.textMuted }, view))
    lines.push(
      textNode(`+${(state.subagentTokens ?? 0).toLocaleString()} from ${subagentCount} ${pluralSubagent(subagentCount)}`, { fg: theme.textMuted }, view),
    )
    lines.push(textNode(`${money.format(state.cost ?? 0)} total`, { fg: theme.textMuted }, view))
  }

  return elementNode("box", { width: "100%", flexDirection: "column" }, lines, view)
}

function currentSessionID(api) {
  return api.route?.current?.params?.sessionID
}

function slotSessionID(api, props = {}) {
  return props.session_id ?? props.sessionID ?? currentSessionID(api)
}

function requestRender(api) {
  api.renderer?.requestRender?.()
}

export async function tui(api, _options, _meta, testOptions = {}) {
  if (typeof api.slots?.register !== "function") return

  const view = testOptions.view ?? (await loadSolidView())
  let fallbackState = testOptions.initialState ?? { ok: false }
  const [state, setState] =
    typeof view.createSignal === "function"
      ? view.createSignal(fallbackState)
      : [
          () => fallbackState,
          (nextState) => {
            fallbackState = nextState
          },
        ]
  let disposed = false
  let inFlight = false
  let activeSessionID = currentSessionID(api)
  let refreshTimer
  let scheduledSessionID

  async function refresh(sessionID) {
    if (disposed || inFlight || !sessionID) return
    inFlight = true
    try {
      setState({ ...(await computeSidebarState(api, sessionID, testOptions)), sessionID })
      requestRender(api)
    } finally {
      inFlight = false
    }
  }

  function scheduleRefresh(sessionID = activeSessionID) {
    if (disposed || !sessionID) return
    activeSessionID = sessionID
    if (scheduledSessionID === sessionID && refreshTimer) return
    scheduledSessionID = sessionID
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      scheduledSessionID = undefined
      refresh(sessionID)
    }, testOptions.refreshDebounceMs ?? REFRESH_DEBOUNCE_MS)
  }

  api.slots.register({
    order: 101,
    slots: {
      sidebar_content(_ctx, props = {}) {
        const sessionID = slotSessionID(api, props)
        if (sessionID && state().sessionID !== sessionID) scheduleRefresh(sessionID)
        return createSidebarElement(api, state(), view)
      },
    },
  })

  const unsubscribers = REFRESH_EVENTS.map((event) => api.event?.on?.(event, () => scheduleRefresh())).filter(Boolean)
  const dispose = () => {
    disposed = true
    clearTimeout(refreshTimer)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
  api.lifecycle?.onDispose?.(dispose)
}

export default {
  id: SERVICE,
  tui,
}
