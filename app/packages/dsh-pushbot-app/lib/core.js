/** Pure helpers for dsh-pushbot: no I/O, no DSH services — unit-testable. */
import { createHash, createHmac } from 'node:crypto'

export function unescapeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

/**
 * Strip markup from a feed field.
 * CDATA must be unwrapped BEFORE tag stripping, otherwise a CDATA payload is
 * swallowed as if it were a tag (regression covered by test/core.test.js).
 */
export function stripTags(value = '') {
  const withoutCdata = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ')
  return unescapeXml(withoutCdata.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

export function pick(re, value) {
  const match = value.match(re)
  return match ? match[1] : undefined
}

export function parseFeed(xml) {
  const items = []
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || []
  for (const block of blocks) {
    const title = stripTags(pick(/<title[^>]*>([\s\S]*?)<\/title>/i, block) || '')
    let link = pick(/<link[^>]*>([\s\S]*?)<\/link>/i, block)
    if (!link) link = pick(/<link[^>]*href=["']([^"']+)["']/i, block)
    link = unescapeXml((link || '').trim())
    const id = unescapeXml((pick(/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i, block) || link || title).trim())
    const published = pick(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i, block)
    const summary = stripTags(pick(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i, block) || '')
    if (!title) continue
    const date = published ? new Date(published) : undefined
    items.push({
      id: id || `${title}|${link}`,
      title,
      url: link,
      date: date && !Number.isNaN(date.valueOf()) ? date.toISOString() : undefined,
      summary: summary.slice(0, 200),
    })
  }
  return items
}

/** Read `a.b.0.c` out of a parsed JSON value; returns undefined on a miss. */
export function pathGet(value, dotted) {
  if (!dotted) return value
  return String(dotted).split('.').reduce((node, key) => {
    if (node === null || node === undefined) return undefined
    return node[key]
  }, value)
}

/** First capture group of `re` in `text`, else the whole match, else undefined. */
export function firstGroup(re, text) {
  if (!re) return undefined
  const match = String(text).match(new RegExp(re, 'is'))
  if (!match) return undefined
  return (match[1] ?? match[0] ?? '').trim()
}

/** Resolve an href found inside a page against that page's URL. */
export function absoluteUrl(href, base) {
  if (!href) return undefined
  try { return new URL(href, base).toString() } catch { return href }
}

export function minutesOfDay(hhmm) {
  const [hour, minute] = String(hhmm).split(':').map(Number)
  return (hour || 0) * 60 + (minute || 0)
}

export function inQuietHours(topic, date = new Date()) {
  const range = topic.quietHours
  if (!Array.isArray(range) || range.length !== 2) return false
  const current = date.getHours() * 60 + date.getMinutes()
  const start = minutesOfDay(range[0])
  const end = minutesOfDay(range[1])
  return start <= end ? current >= start && current < end : current >= start || current < end
}

export function isDue(topicState, topic, now = Date.now()) {
  const intervalMs = Math.max(1, Number(topic.everyMinutes ?? 30)) * 60000
  return now - Number(topicState.lastRunAt || 0) >= intervalMs
}

/** Newest first when a date exists; otherwise keep the upstream order. */
export function sortItems(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const da = Date.parse(a.item.date || 0)
      const db = Date.parse(b.item.date || 0)
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return db - da
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

function haystack(item) {
  return `${item.title || ''} ${item.summary || ''}`.toLowerCase()
}

/**
 * Keyword filter. `includeAny` is one OR-group, `includeAll` is a list of
 * OR-groups that must *all* match (e.g. [AI words] AND [price words]).
 */
export function applyFilter(items, topic = {}) {
  const filter = topic.filter || {}
  const toWords = (value) => (Array.isArray(value) ? value : [])
    .map((word) => String(word).toLowerCase()).filter(Boolean)
  const include = toWords(filter.includeAny)
  const exclude = toWords(filter.excludeAny)
  const includeAll = (Array.isArray(filter.includeAll) ? filter.includeAll : [])
    .map(toWords).filter((group) => group.length)
  return items.filter((item) => {
    const text = haystack(item)
    if (exclude.some((word) => text.includes(word))) return false
    if (include.length && !include.some((word) => text.includes(word))) return false
    if (includeAll.length && !includeAll.every((group) => group.some((word) => text.includes(word)))) return false
    return true
  })
}

export function formatDigest(topic, items) {
  const max = Number(topic.maxItemsPerPush ?? 8)
  const lines = [`【${topic.name || topic.id}】${items.length} 条新内容`, '']
  items.slice(0, max).forEach((item, index) => {
    const label = item.source ? `[${item.source}] ` : ''
    lines.push(`${index + 1}. ${label}${item.title}`)
    if (item.url) lines.push(`   ${item.url}`)
  })
  if (items.length > max) lines.push(`… 另有 ${items.length - max} 条未列出`)
  return lines.join('\n')
}

/** Exponential retry delay: 1 min, 2 min, 4 min … capped at 30 min. */
export function backoffMs(attempts, baseMs = 60000, capMs = 1800000) {
  const exponent = Math.max(0, Number(attempts || 0) - 1)
  return Math.min(baseMs * 2 ** exponent, capMs)
}

/** Drop scripts/styles/comments and collapse whitespace so page diffs are stable. */
export function normalizePage(html = '') {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Feishu custom-bot signature: HMAC-SHA256(key = `${timestamp}\n${secret}`, data = '') in base64. */
export function feishuSign(secret, timestamp) {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64')
}

export function buildFeishuBody(text, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const body = { msg_type: 'text', content: { text } }
  if (secret) {
    body.timestamp = String(nowSeconds)
    body.sign = feishuSign(secret, nowSeconds)
  }
  return body
}

/** Body accepted by dsh-im's proactive delivery endpoint. */
export function buildDshImBody(botId, targetId, text, format = 'markdown') {
  const body = { botId, targetId, text }
  if (format && format !== 'plain') body.format = format
  return body
}

/**
 * Payload for the Feishu Open API, using the app identity (tenant token).
 * `markdown` becomes an interactive card so headings/lists render; `plain` stays text.
 */
export function buildFeishuAppPayload(text, format = 'markdown') {
  if (format === 'plain') {
    return { msg_type: 'text', content: JSON.stringify({ text }) }
  }
  const card = {
    config: { wide_screen_mode: true },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
  }
  return { msg_type: 'interactive', content: JSON.stringify(card) }
}

/** Token considered stale 60s before it actually expires. */
export function tokenFresh(expiresAt, now = Date.now(), marginMs = 60000) {
  return Boolean(expiresAt) && now < expiresAt - marginMs
}

export function hashText(text = '') {
  return createHash('sha256').update(String(text)).digest('hex')
}

export function parseHnItem(json, sourceLabel) {
  if (!json || !json.id || !json.title) return null
  return {
    id: `hn:${json.id}`,
    title: json.title,
    url: json.url || `https://news.ycombinator.com/item?id=${json.id}`,
    date: json.time ? new Date(json.time * 1000).toISOString() : undefined,
    summary: stripTags(String(json.text || '')).slice(0, 200),
    source: sourceLabel,
  }
}

export function parseHnSearch(json, sourceLabel) {
  const hits = Array.isArray(json?.hits) ? json.hits : []
  return hits
    .filter((hit) => hit && (hit.title || hit.story_title))
    .map((hit) => ({
      id: `hn-search:${hit.objectID}`,
      title: hit.title || hit.story_title,
      url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      date: hit.created_at,
      summary: stripTags(String(hit.comment_text || '')).slice(0, 200),
      source: sourceLabel,
    }))
}

export function parseV2ex(json, sourceLabel) {
  const rows = Array.isArray(json) ? json : []
  return rows
    .filter((row) => row && row.title)
    .map((row) => ({
      id: `v2ex:${row.id}`,
      title: row.title,
      url: row.url || `https://www.v2ex.com/t/${row.id}`,
      date: row.created ? new Date(row.created * 1000).toISOString() : undefined,
      summary: stripTags(String(row.content || '')).slice(0, 200),
      source: sourceLabel,
    }))
}

/** Deterministic digest used when no LLM is configured or the call fails. */
export function fallbackSummary(topic, items) {
  return formatDigest(topic, items)
}

export function buildSummaryPrompt(topic, items) {
  const lines = items.map((item, index) => {
    const bits = [`${index + 1}. ${item.title}`]
    if (item.source) bits.push(`来源: ${item.source}`)
    if (item.url) bits.push(`链接: ${item.url}`)
    if (item.summary) bits.push(`摘要: ${item.summary}`)
    return bits.join(' | ')
  })
  return [
    `你是「${topic.name || topic.id}」主题的情报编辑。下面是本轮新抓到的原始条目：`,
    ...lines,
    '',
    '请输出一段适合手机阅读的中文简报：',
    '- 只保留真正有信息量的条目，合并同一事件的重复报道',
    '- 每条一行，格式：· 一句话事实（≤40 字）',
    '- 最多 8 条，不要编造原文没有的数字或结论',
    '- 不要输出标题、序号或客套话',
  ].join('\n')
}

/** Trim common LLM wrappers so the push body stays clean. */
export function cleanLlmText(reply = '') {
  return String(reply)
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/i, '')
    .replace(/^\s*(简报|摘要)\s*[:：]\s*/i, '')
    .trim()
    .slice(0, 4000)
}

export function formatDailyReport(dateKey, entries, stats = {}) {
  const lines = [`# ${dateKey} 推送日报`, '']
  lines.push(`- 投递主题数：${stats.topics ?? 0}`)
  lines.push(`- 新内容条数：${entries.length}`)
  lines.push(`- 抓取成功/失败：${stats.sourcesOk ?? 0}/${stats.sourcesFailed ?? 0}`)
  lines.push('')
  if (!entries.length) {
    lines.push('今日没有新内容。')
    return lines.join('\n')
  }
  const grouped = new Map()
  for (const entry of entries) {
    const key = entry.topic || 'unknown'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(entry)
  }
  for (const [topic, rows] of grouped) {
    lines.push(`## ${topic}（${rows.length}）`)
    for (const row of rows) {
      lines.push(`- ${row.title}${row.url ? ` — ${row.url}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
