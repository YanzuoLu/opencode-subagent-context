const SERVICE = "opencode-subagent-context"
const DEFAULT_LIST_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 50
const REFRESH_DEBOUNCE_MS = 100
const TOKEN_PRICE_DENOMINATOR = 1_000_000
const BUILT_IN_PRICES = {
  "openai/gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5, reasoning: 30 },
  "openai/gpt-5.5-pro": { input: 30, output: 180, cacheRead: 30, cacheWrite: 30, reasoning: 180 },
  "openai/gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5, reasoning: 15 },
  "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75, reasoning: 4.5 },
}
const BREAKDOWN_CATEGORIES = [
  { key: "input", label: "in", tokens: (tokens) => numberOrZero(tokens?.input), price: (price) => price.input },
  { key: "output", label: "out", tokens: (tokens) => numberOrZero(tokens?.output), price: (price) => price.output },
  { key: "reasoning", label: "rsn", tokens: (tokens) => numberOrZero(tokens?.reasoning), price: (price) => priceOrDefault(price.reasoning, price.output) },
  { key: "cacheRead", label: "cache", tokens: (tokens) => numberOrZero(tokens?.cache?.read), price: (price) => priceOrDefault(price.cacheRead, price.input) },
  { key: "cacheWrite", label: "write", tokens: (tokens) => numberOrZero(tokens?.cache?.write), price: (price) => priceOrDefault(price.cacheWrite, price.input) },
]
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})
const tokenCountNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const TOKEN_COUNT_SUFFIXES = ["K", "M", "B", "T"]
const REFRESH_EVENTS = ["session.created", "session.updated", "session.deleted", "message.updated", "session.next.step.ended"]

function readData(result) {
  return result && typeof result === "object" && "data" in result ? result.data : result
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function priceOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function formatTokenCount(value) {
  const count = numberOrZero(value)
  if (count < 1_000) return count.toLocaleString("en-US")

  let scaled = count / 1_000
  let suffixIndex = 0
  while (scaled >= 1_000 && suffixIndex < TOKEN_COUNT_SUFFIXES.length - 1) {
    scaled /= 1_000
    suffixIndex += 1
  }
  return `${tokenCountNumber.format(scaled)}${TOKEN_COUNT_SUFFIXES[suffixIndex]}`
}

function isAssistantMessage(message) {
  return message?.role === "assistant" || message?.type === "assistant"
}

function messageInfo(message) {
  return message?.info ?? message
}

export function contextTokensForMessage(message) {
  const info = messageInfo(message)
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

function addPrice(indexes, key, price) {
  const normalizedKey = typeof key === "string" ? key.toLowerCase() : undefined
  if (!normalizedKey || !validPrice(price)) return

  indexes.byProviderModel[normalizedKey] = price

  const slashIndex = normalizedKey.indexOf("/")
  if (slashIndex < 0) return

  const modelID = normalizedKey.slice(slashIndex + 1)
  if (!modelID) return

  const list = indexes.byModel[modelID] ?? []
  list.push(price)
  indexes.byModel[modelID] = list
}

function priceFromCatalogModel(model) {
  const cost = Array.isArray(model?.cost) ? model.cost[0] : model?.cost
  if (!cost) return undefined

  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache?.read,
    cacheWrite: cost.cache?.write,
    reasoning: cost.output,
  }
}

function pricesFromCatalogModels(models, fallbackProviderID) {
  const prices = {}
  const list = Array.isArray(models) ? models : models && typeof models === "object" ? Object.values(models) : []
  for (const model of list) {
    const providerID = model?.providerID ?? fallbackProviderID
    const modelID = model?.id
    const price = priceFromCatalogModel(model)
    if (!providerID || !modelID || !validPrice(price)) continue
    prices[`${providerID}/${modelID}`.toLowerCase()] = price
  }
  return prices
}

async function providerConfigPrices(api) {
  // Call as a method so the SDK resource keeps its `this`; a detached reference loses `this.client`.
  const config = api.client?.config
  if (typeof config?.providers !== "function") return {}

  try {
    const data = readData(await config.providers(pathOptions(api)))
    const list = Array.isArray(data?.providers) ? data.providers : Array.isArray(data) ? data : []
    const prices = {}
    for (const provider of list) Object.assign(prices, pricesFromCatalogModels(provider?.models, provider?.id))
    return prices
  } catch {
    return {}
  }
}

async function modelListPrices(api) {
  const model = api.client?.v2?.model
  if (typeof model?.list !== "function") return {}

  try {
    return pricesFromCatalogModels(readData(await model.list({ location: pathOptions(api) })))
  } catch {
    return {}
  }
}

async function catalogPrices(api) {
  return { ...(await modelListPrices(api)), ...(await providerConfigPrices(api)) }
}

async function preparePrices(api, options = {}) {
  const indexes = { byProviderModel: {}, byModel: {} }
  // Lowest precedence first so later writes win: live catalog < curated built-ins < user-configured prices.
  // A model the provider catalog reports at $0 (subscription/coding-plan) must not clobber a real
  // API-equivalent built-in or user price, so catalog is applied before, not after, the curated tables.
  for (const [key, price] of Object.entries(await catalogPrices(api))) addPrice(indexes, key, price)
  for (const [key, price] of Object.entries(BUILT_IN_PRICES)) addPrice(indexes, key, price)
  for (const [key, price] of Object.entries(options.prices ?? {})) addPrice(indexes, key, price)
  return indexes
}

function modelKeyForMessage(message) {
  const info = messageInfo(message)
  const providerID = info?.providerID ?? info?.model?.providerID
  const modelID = info?.modelID ?? info?.model?.id
  if (!providerID || !modelID) return undefined
  return `${providerID}/${modelID}`.toLowerCase()
}

function validPrice(price) {
  return typeof price?.input === "number" && Number.isFinite(price.input) && typeof price?.output === "number" && Number.isFinite(price.output)
}

function messageCostWithPrice(tokens, price) {
  const breakdown = emptyBreakdown()
  let cost = 0

  for (const category of BREAKDOWN_CATEGORIES) {
    const count = category.tokens(tokens)
    const categoryCost = (count * category.price(price)) / TOKEN_PRICE_DENOMINATOR
    breakdown[category.key].totalTokens = count
    breakdown[category.key].cost = categoryCost
    cost += categoryCost
  }

  return { available: true, cost, breakdown }
}

function priceCandidatesForMessage(message, prices) {
  const key = modelKeyForMessage(message)
  const direct = key ? prices.byProviderModel[key] : undefined
  if (validPrice(direct)) return [direct]

  const info = messageInfo(message)
  const modelID = (info?.modelID ?? info?.model?.id)?.toLowerCase?.()
  return modelID ? prices.byModel[modelID] ?? [] : []
}

function emptyBreakdown() {
  const breakdown = {}
  for (const category of BREAKDOWN_CATEGORIES) {
    breakdown[category.key] = { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true }
  }
  return breakdown
}

function mergeBreakdown(target, source, isSubagent = false) {
  for (const category of BREAKDOWN_CATEGORIES) {
    const targetPart = target[category.key]
    const sourcePart = source?.[category.key]
    const tokens = sourcePart?.totalTokens ?? 0
    targetPart.totalTokens += tokens
    if (isSubagent) targetPart.subagentTokens += tokens
    targetPart.cost += sourcePart?.cost ?? 0
    if (sourcePart?.costAvailable === false) targetPart.costAvailable = false
  }
}

function costForMessage(message, prices) {
  const tokens = messageInfo(message)?.tokens
  const breakdown = emptyBreakdown()
  if (contextTokensForMessage(message) <= 0) return { available: true, cost: 0, breakdown }

  const candidates = priceCandidatesForMessage(message, prices)
  if (!candidates.length) {
    for (const category of BREAKDOWN_CATEGORIES) {
      const count = category.tokens(tokens)
      breakdown[category.key].totalTokens = count
      if (count > 0) breakdown[category.key].costAvailable = false
    }
    return { available: false, cost: 0, breakdown }
  }

  return candidates.map((price) => messageCostWithPrice(tokens, price)).sort((a, b) => b.cost - a.cost)[0]
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

async function collectDescendantsFromChildren(api, rootID) {
  const result = []
  const seen = new Set([rootID])
  const queue = [rootID]

  while (queue.length) {
    const parentID = queue.shift()
    const children = await readSessionChildren(api, parentID)
    if (!children) return undefined
    for (const child of children) {
      if (!child?.id || seen.has(child.id)) continue
      seen.add(child.id)
      result.push(child.id)
      queue.push(child.id)
    }
  }

  return result
}

async function readSessionMessages(api, sessionID, options) {
  const client = sessionClient(api)
  if (typeof client?.messages !== "function") throw new Error(`${SERVICE}: session.messages is unavailable`)
  const input = {
    ...pathOptions(api),
    sessionID,
  }
  if (options.messageLimit !== undefined) input.limit = options.messageLimit
  const output = await client.messages(input)
  return readData(output) ?? []
}

async function cumulativeUsageForSession(api, sessionID, options, prices) {
  const messages = await readSessionMessages(api, sessionID, options)
  let tokens = 0
  let cost = 0
  let costAvailable = true
  const breakdown = emptyBreakdown()
  for (let index = messages.length - 1; index >= 0; index--) {
    const messageTokens = contextTokensForMessage(messages[index])
    if (messageTokens <= 0) continue
    const messageCost = costForMessage(messages[index], prices)
    tokens += messageTokens
    cost += messageCost.cost
    mergeBreakdown(breakdown, messageCost.breakdown)
    if (!messageCost.available) costAvailable = false
  }
  return { tokens, cost, costAvailable, breakdown }
}

export async function computeSidebarState(api, sessionID, options = {}) {
  try {
    const prices = await preparePrices(api, options)
    const childTree = await collectDescendantsFromChildren(api, sessionID)
    const sessions = childTree ? [] : await listSessions(api, options)
    const descendants = childTree ?? collectDescendantIDs(sessions, sessionID)
    const allIDs = [sessionID, ...descendants]
    let mainTokens = 0
    let subagentTokens = 0
    let subagentCount = 0
    let cost = 0
    let costAvailable = true
    const breakdown = emptyBreakdown()

    for (const id of allIDs) {
      const usage = await cumulativeUsageForSession(api, id, options, prices)
      if (!usage.costAvailable) costAvailable = false
      cost += usage.cost
      if (id === sessionID) {
        mainTokens = usage.tokens
        mergeBreakdown(breakdown, usage.breakdown)
        continue
      }
      subagentTokens += usage.tokens
      mergeBreakdown(breakdown, usage.breakdown, true)
      if (usage.tokens > 0) subagentCount += 1
    }

    return {
      ok: true,
      mainTokens,
      subagentTokens,
      totalTokens: mainTokens + subagentTokens,
      subagentCount,
      cost,
      costAvailable,
      breakdown,
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
  const lines = [textNode("Usage", { fg: theme.text }, view)]

  if (!state?.ok) {
    lines.push(textNode("subagent total unavailable", { fg: theme.textMuted }, view))
  } else {
    const subagentCount = state.subagentCount ?? 0
    lines.push(textNode(`${formatTokenCount(state.totalTokens ?? 0)} tokens used total`, { fg: theme.textMuted }, view))
    lines.push(
      textNode(`+${formatTokenCount(state.subagentTokens ?? 0)} used by ${subagentCount} ${pluralSubagent(subagentCount)}`, { fg: theme.textMuted }, view),
    )
    lines.push(textNode(state.costAvailable === false ? "API cost unavailable" : `${money.format(state.cost ?? 0)} spent total`, { fg: theme.textMuted }, view))
    const breakdown = state.breakdown ?? emptyBreakdown()
    for (const category of BREAKDOWN_CATEGORIES) {
      const part = breakdown[category.key] ?? { totalTokens: 0, subagentTokens: 0, cost: 0, costAvailable: true }
      const cost = part.costAvailable === false ? "unavailable" : money.format(part.cost ?? 0)
      lines.push(
        textNode(
          `${category.label} ${formatTokenCount(part.totalTokens ?? 0)} (+${formatTokenCount(part.subagentTokens ?? 0)}) / ${cost}`,
          { fg: theme.textMuted },
          view,
        ),
      )
    }
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

export async function tui(api, options = {}, _meta, testOptions = {}) {
  if (typeof api.slots?.register !== "function") return

  const view = testOptions.view ?? (await loadSolidView())
  const computeOptions = { ...options, ...testOptions }
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
      setState({ ...(await computeSidebarState(api, sessionID, computeOptions)), sessionID })
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
