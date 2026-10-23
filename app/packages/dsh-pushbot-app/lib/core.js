/** Pure helpers for dsh-pushbot: no I/O, no DSH services — unit-testable. */

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

export function formatDigest(topic, items) {
  const max = Number(topic.maxItemsPerPush ?? 8)
  const lines = [`【${topic.name || topic.id}】${items.length} 条新内容`, '']
  items.slice(0, max).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`)
    if (item.url) lines.push(`   ${item.url}`)
  })
  if (items.length > max) lines.push(`… 另有 ${items.length - max} 条未列出`)
  return lines.join('\n')
}
