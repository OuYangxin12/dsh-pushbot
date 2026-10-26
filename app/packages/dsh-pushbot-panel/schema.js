/**
 * Validation and normalisation for the pushbot config document.
 *
 * The panel is a convenience layer, never a source of truth: every value that
 * reaches disk passes through here, unknown fields are dropped, and secrets
 * (notifiers) are preserved from the existing file rather than taken from the UI.
 */

export const SOURCE_KINDS = {
  rss: { label: 'RSS / Atom', fields: ['url'] },
  atom: { label: 'RSS / Atom', fields: ['url'] },
  github: { label: 'GitHub 仓库', fields: ['repo', 'events', 'limit'] },
  'github-search': { label: 'GitHub 搜索', fields: ['query', 'sinceDays', 'sort', 'limit'] },
  hackernews: { label: 'Hacker News 热榜', fields: ['limit'] },
  'hn-search': { label: 'HN 关键词搜索', fields: ['query', 'sinceDays', 'limit'] },
  v2ex: { label: 'V2EX 热帖', fields: ['limit'] },
  page: { label: '网页变更 / 断言', fields: ['url', 'region', 'expect', 'name'] },
  'html-list': { label: '任意网页列表', fields: ['url', 'item', 'title', 'link', 'summary', 'limit'] },
  'json-api': { label: '任意 JSON 接口', fields: ['url', 'itemsPath', 'titlePath', 'urlPath', 'idPath', 'datePath', 'summaryPath', 'limit'] },
}

export const REQUIRED_SOURCE_FIELDS = {
  rss: ['url'],
  atom: ['url'],
  github: ['repo'],
  'hn-search': ['query'],
  page: ['url'],
  'html-list': ['url', 'title'],
  'json-api': ['url'],
}

export const NOTIFIER_KINDS = ['feishu-app', 'dsh-im', 'feishu-webhook', 'webhook', 'file', 'console']
export const IMPROVE_POLICIES = ['auto', 'approval', 'off']

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const TOPIC_ID = /^[a-z0-9][a-z0-9_-]{0,40}$/

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const int = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function normaliseSource(raw) {
  if (!isObject(raw)) return null
  const kind = str(raw.kind, 24)
  const meta = SOURCE_KINDS[kind]
  if (!meta) return null
  const source = { kind }
  for (const field of meta.fields) {
    const value = raw[field]
    if (field === 'expect') {
      if (isObject(value) && (value.contains || value.absent)) {
        source.expect = {}
        if (str(value.contains, 200)) source.expect.contains = str(value.contains, 200)
        if (str(value.absent, 200)) source.expect.absent = str(value.absent, 200)
      }
      continue
    }
    if (field === 'limit') { source.limit = int(value, 1, 50, 10); continue }
    if (field === 'sinceDays') { source.sinceDays = int(value, 1, 90, 7); continue }
    if (field === 'events') {
      const events = (Array.isArray(value) ? value : ['release'])
        .map((event) => str(event, 16)).filter((event) => ['release', 'commit'].includes(event))
      source.events = events.length ? events : ['release']
      continue
    }
    const text = str(value, 500)
    if (text) source[field] = text
  }
  for (const required of REQUIRED_SOURCE_FIELDS[kind] || []) {
    if (!source[required]) return null
  }
  if (raw.bypassFilter === true) source.bypassFilter = true
  return source
}

function normaliseFilter(raw) {
  if (!isObject(raw)) return undefined
  const list = (value) => (Array.isArray(value) ? value : [])
    .map((word) => str(word, 40)).filter(Boolean).slice(0, 20)
  const includeAny = list(raw.includeAny)
  const excludeAny = list(raw.excludeAny)
  const includeAll = (Array.isArray(raw.includeAll) ? raw.includeAll : [])
    .map(list).filter((group) => group.length).slice(0, 5)
  if (!includeAny.length && !excludeAny.length && !includeAll.length) return undefined
  return {
    ...(includeAny.length ? { includeAny } : {}),
    ...(includeAll.length ? { includeAll } : {}),
    ...(excludeAny.length ? { excludeAny } : {}),
  }
}

function normaliseQuietHours(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined
  const start = str(raw[0], 5)
  const end = str(raw[1], 5)
  if (!TIME.test(start) || !TIME.test(end) || start === end) return undefined
  return [start, end]
}

export function normaliseTopic(raw, index, notifierIds) {
  if (!isObject(raw)) return null
  const name = str(raw.name, 80) || `主题 ${index + 1}`
  let id = str(raw.id, 41).toLowerCase()
  if (!TOPIC_ID.test(id)) id = `topic-${index + 1}`
  const notifier = str(raw.notifier, 64)
  const sources = (Array.isArray(raw.sources) ? raw.sources : [])
    .map(normaliseSource).filter(Boolean).slice(0, 20)
  if (!sources.length) return null
  const topic = {
    id,
    name,
    everyMinutes: int(raw.everyMinutes, 1, 1440, 30),
    notifier: notifierIds.includes(notifier) ? notifier : notifierIds[0],
    sources,
  }
  if (raw.disabled === true) topic.disabled = true
  const quiet = normaliseQuietHours(raw.quietHours)
  if (quiet) topic.quietHours = quiet
  const filter = normaliseFilter(raw.filter)
  if (filter) topic.filter = filter
  if (raw.maxItemsPerRun !== undefined) topic.maxItemsPerRun = int(raw.maxItemsPerRun, 1, 100, 20)
  if (raw.maxItemsPerPush !== undefined) topic.maxItemsPerPush = int(raw.maxItemsPerPush, 1, 50, 8)
  return topic
}

/**
 * @param {unknown} draft config document proposed by the panel
 * @param {{ previous?: object }} options existing on-disk config (source of notifiers)
 * @returns {{ errors: string[], config: object|null }}
 */
export function validateConfig(draft, { previous = {} } = {}) {
  const errors = []
  if (!isObject(draft)) return { errors: ['配置必须是对象'], config: null }

  // notifiers are owned by the setup scripts: keep whatever is on disk
  const notifiers = isObject(previous.notifiers) ? previous.notifiers : {}
  const notifierIds = Object.keys(notifiers).filter((id) => notifiers[id]?.kind)
  if (!notifierIds.length) errors.push('磁盘上的配置没有可用的通知器')

  const topics = []
  const seen = new Set()
  for (const [index, raw] of (Array.isArray(draft.topics) ? draft.topics : []).entries()) {
    const topic = normaliseTopic(raw, index, notifierIds)
    if (!topic) { errors.push(`第 ${index + 1} 个主题无效：缺少名称或至少一个合法源`); continue }
    let id = topic.id
    let suffix = 2
    while (seen.has(id)) { id = `${topic.id}-${suffix}`; suffix += 1 }
    seen.add(id)
    topics.push({ ...topic, id })
  }
  if (!topics.length) errors.push('至少需要保留一个主题')

  const config = { ...previous, topics }
  if (config.notifiers === undefined) config.notifiers = notifiers

  if (draft.llm !== undefined) {
    const raw = isObject(draft.llm) ? draft.llm : {}
    config.llm = {
      enabled: raw.enabled === true,
      model: str(raw.model, 80) || 'deepseek-chat',
      baseUrl: str(raw.baseUrl, 200) || 'https://api.deepseek.com',
      apiKeyEnv: str(raw.apiKeyEnv, 64) || 'PUSHBOT_LLM_API_KEY',
      maxCallsPerDay: int(raw.maxCallsPerDay, 1, 500, 20),
    }
  }

  if (draft.dailyReport !== undefined) {
    if (draft.dailyReport === null) {
      delete config.dailyReport
    } else {
      const raw = isObject(draft.dailyReport) ? draft.dailyReport : {}
      const at = str(raw.at, 5)
      if (!TIME.test(at)) errors.push('日报时间格式必须是 HH:MM')
      const notifier = str(raw.notifier, 64)
      config.dailyReport = {
        at: TIME.test(at) ? at : '09:00',
        notifier: notifierIds.includes(notifier) ? notifier : notifierIds[0],
      }
    }
  }

  if (draft.automation !== undefined) {
    const raw = isObject(draft.automation) ? draft.automation : {}
    const policy = str(raw.improve, 16)
    config.automation = { improve: IMPROVE_POLICIES.includes(policy) ? policy : 'auto' }
  }

  return { errors, config: errors.length ? null : config }
}
