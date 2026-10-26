/**
 * Source adapters. Every network call goes through injected `fetchText` /
 * `fetchJson` so the adapters stay unit-testable without network access.
 */
import {
  absoluteUrl, firstGroup, hashText, normalizePage, parseFeed, parseHnItem,
  parseHnSearch, parseV2ex, pathGet, stripTags,
} from './core.js'

export function sourceKey(source) {
  const identity = source.url || source.repo || source.query || source.board || ''
  const events = Array.isArray(source.events) ? source.events.join(',') : ''
  return `${source.kind}|${identity}|${events}`
}

function label(source, fallback) {
  return source.name || fallback
}

async function collectGithub(source, { fetchJson, token }) {
  const repo = source.repo
  if (!repo) throw new Error('github source requires "repo"')
  const limit = Number(source.limit ?? 3)
  const events = Array.isArray(source.events) && source.events.length ? source.events : ['release']
  const headers = { accept: 'application/vnd.github+json' }
  if (token) headers.authorization = `Bearer ${token}`
  const items = []
  for (const event of events) {
    if (event === 'release') {
      const rows = await fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=${limit}`, { headers })
      for (const row of rows || []) {
        items.push({
          id: `gh-release:${repo}:${row.id}`,
          title: `${repo} 发布 ${row.tag_name || row.name || ''}`.trim(),
          url: row.html_url,
          date: row.published_at,
          summary: stripTags(row.body || '').slice(0, 160),
          source: label(source, 'github'),
        })
      }
    } else if (event === 'commit') {
      const rows = await fetchJson(`https://api.github.com/repos/${repo}/commits?per_page=${limit}`, { headers })
      for (const row of rows || []) {
        items.push({
          id: `gh-commit:${repo}:${row.sha}`,
          title: `${repo} 新提交 ${String(row.sha).slice(0, 7)}: ${(row.commit?.message || '').split('\n')[0].slice(0, 80)}`,
          url: row.html_url,
          date: row.commit?.author?.date,
          source: label(source, 'github'),
        })
      }
    } else {
      throw new Error(`unsupported github event: ${event}`)
    }
  }
  return items
}

async function collectHackerNews(source, { fetchJson }) {
  const limit = Number(source.limit ?? 8)
  const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json')
  const slice = (Array.isArray(ids) ? ids : []).slice(0, limit)
  const rows = await Promise.all(
    slice.map((id) => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)),
  )
  return rows.map((row) => parseHnItem(row, label(source, 'HN'))).filter(Boolean)
}

async function collectHnSearch(source, { fetchJson, now }) {
  const limit = Number(source.limit ?? 8)
  const endpoint = source.endpoint || 'https://hn.algolia.com/api/v1/search_by_date'
  const query = encodeURIComponent(source.query || '')
  const sinceDays = Number(source.sinceDays ?? 2)
  const cutoff = Math.floor(now / 1000) - sinceDays * 86400
  const url = `${endpoint}?query=${query}&tags=story&hitsPerPage=${limit}&numericFilters=created_at_i>${cutoff}`
  const json = await fetchJson(url)
  return parseHnSearch(json, label(source, 'HN搜索'))
}

async function collectV2ex(source, { fetchJson }) {
  const json = await fetchJson(source.endpoint || 'https://www.v2ex.com/api/topics/hot.json')
  return parseV2ex(json, label(source, 'V2EX')).slice(0, Number(source.limit ?? 8))
}

/**
 * Generic HTML list: split the page into blocks with `item`, then pull
 * `title` / `link` / `date` out of each block with regexes.
 * No DOM, no dependencies — one regex per field keeps arbitrary sites reachable.
 */
async function collectHtmlList(source, { fetchText }) {
  const html = await fetchText(source.url)
  const limit = Number(source.limit ?? 10)
  const blocks = source.item
    ? [...html.matchAll(new RegExp(source.item, 'gis'))].map((match) => match[1] ?? match[0])
    : [html]
  const items = []
  for (const block of blocks) {
    const title = stripTags(firstGroup(source.title, block) || '')
    if (!title) continue
    const href = firstGroup(source.link, block)
    items.push({
      id: `${source.url}|${href || title}`,
      title,
      url: absoluteUrl(href, source.url),
      summary: stripTags(firstGroup(source.summary, block) || '').slice(0, 200),
      source: label(source, 'page'),
    })
    if (items.length >= limit) break
  }
  return items
}

/** Generic JSON API: point at an array and map fields with dotted paths. */
async function collectJsonApi(source, { fetchJson }) {
  const json = await fetchJson(source.url, source.headers ? { headers: source.headers } : undefined)
  const rows = pathGet(json, source.itemsPath)
  if (!Array.isArray(rows)) throw new Error('json-api: itemsPath is not an array')
  const limit = Number(source.limit ?? 10)
  return rows.slice(0, limit).map((row, index) => {
    const title = String(pathGet(row, source.titlePath ?? 'title') ?? '').trim()
    const href = pathGet(row, source.urlPath ?? 'url')
    return {
      id: `${source.url}|${pathGet(row, source.idPath ?? 'id') ?? title ?? index}`,
      title,
      url: href ? absoluteUrl(String(href), source.url) : undefined,
      date: pathGet(row, source.datePath ?? '') || undefined,
      summary: stripTags(String(pathGet(row, source.summaryPath ?? '') ?? '')).slice(0, 200),
      source: label(source, 'api'),
    }
  }).filter((item) => item.title)
}

/** GitHub repository search, e.g. trending: created in the last N days sorted by stars. */
async function collectGithubSearch(source, { fetchJson, token, now }) {
  const days = Number(source.sinceDays ?? 7)
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10)
  const query = String(source.query || 'stars:>100').replaceAll('{since}', since)
  const limit = Number(source.limit ?? 5)
  const headers = { accept: 'application/vnd.github+json' }
  if (token) headers.authorization = `Bearer ${token}`
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=${source.sort || 'stars'}&order=desc&per_page=${limit}`
  const json = await fetchJson(url, { headers })
  return (json.items || []).map((row) => ({
    id: `gh-repo:${row.full_name}`,
    title: `${row.full_name} ★${row.stargazers_count} — ${row.description || ''}`.slice(0, 140),
    url: row.html_url,
    date: row.pushed_at,
    summary: String(row.description || '').slice(0, 200),
    source: label(source, 'GitHub'),
  }))
}

/**
 * Web-page monitoring.
 *
 * Modes:
 *  - change detection (default): hash a normalized region, emit when it moves.
 *  - assertion (`expect.contains` / `expect.absent`): emit while the assertion
 *    is violated — e.g. alert when "缺货" shows up or "现货" disappears.
 * The first observation only records a baseline; it never pushes.
 */
async function collectPage(source, { fetchText, previous, now }) {
  const html = await fetchText(source.url)
  let region = html
  if (source.region) {
    const match = String(html).match(new RegExp(source.region, 'is'))
    region = match ? (match[1] ?? match[0]) : html
  }
  const text = normalizePage(region)
  const hash = hashText(text)
  const state = { hash, checkedAt: new Date(now).toISOString(), excerpt: text.slice(0, 400) }
  const name = label(source, source.url)
  const previousHash = previous?.hash
  const items = []

  const expect = source.expect
  if (expect && (expect.contains || expect.absent)) {
    const flags = expect.flags || 'is'
    let violated = false
    let detail = ''
    if (expect.contains) {
      const present = new RegExp(expect.contains, flags).test(text)
      if (!present) { violated = true; detail = `未找到「${expect.contains}」` }
    }
    if (!violated && expect.absent) {
      const present = new RegExp(expect.absent, flags).test(text)
      if (present) { violated = true; detail = `出现「${expect.absent}」` }
    }
    if (violated) {
      items.push({
        id: `page-expect:${source.url}:${hash.slice(0, 16)}`,
        title: `${name} 断言不满足：${detail}`,
        url: source.url,
        date: new Date(now).toISOString(),
        summary: text.slice(0, 200),
        source: name,
      })
    }
    return { items, state }
  }

  if (source.reportFirstRun === true || (previousHash && previousHash !== hash)) {
    items.push({
      id: `page:${source.url}:${hash.slice(0, 16)}`,
      title: previousHash ? `${name} 内容有变化` : `${name} 首次抓取`,
      url: source.url,
      date: new Date(now).toISOString(),
      summary: text.slice(0, 200),
      source: name,
    })
  }
  return { items, state }
}

/**
 * @returns {Promise<{items: object[], state?: object}>}
 */
export async function collectSource(source, deps = {}) {
  const { previous, now = Date.now() } = deps
  switch (source.kind) {
    case 'rss':
    case 'atom': {
      const xml = await deps.fetchText(source.url)
      const items = parseFeed(xml)
        .slice(0, Number(source.limit ?? 10))
        .map((item) => ({ ...item, source: label(source, source.kind.toUpperCase()) }))
      return { items }
    }
    case 'github':
      return { items: await collectGithub(source, deps) }
    case 'hackernews':
    case 'hn':
      return { items: await collectHackerNews(source, deps) }
    case 'hn-search':
      return { items: await collectHnSearch(source, deps) }
    case 'v2ex':
      return { items: await collectV2ex(source, deps) }
    case 'html-list':
      return { items: await collectHtmlList(source, deps) }
    case 'json-api':
      return { items: await collectJsonApi(source, deps) }
    case 'github-search':
      return { items: await collectGithubSearch(source, { ...deps, now }) }
    case 'page':
      return await collectPage(source, { ...deps, previous, now })
    default:
      throw new Error(`unsupported source kind: ${source.kind}`)
  }
}
