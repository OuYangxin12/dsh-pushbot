/**
 * dsh-pushbot — resident headless watch & notify plugin for DeepSeek Harness.
 *
 * Runs a timer-driven pipeline inside a headless DSH profile:
 *   sources (rss | github) -> dedup (per-topic seen ids) -> digest -> notifier
 * State and heartbeat live under $PUSHBOT_ROOT/data so an external watchdog can
 * restart the service when the heartbeat goes stale. No HTTP server, no UI.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { isDue, inQuietHours, parseFeed, stripTags, formatDigest } from './core.js'

export const name = 'dsh-pushbot'
export const inject = ['timer']

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const CONFIG_PATH = process.env.PUSHBOT_CONFIG || path.join(ROOT, 'config.json')
const DATA_DIR = path.join(ROOT, 'data')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const HEALTH_PATH = path.join(DATA_DIR, 'health.json')
const TICK_MS = Number(process.env.PUSHBOT_TICK_MS || 30000)
const RUN_ONCE = process.env.PUSHBOT_RUN_ONCE === '1'
const VERSION = '0.1.0'
const STARTED_AT = new Date().toISOString()

const log = (...args) => console.log(new Date().toISOString(), '[pushbot]', ...args)
const nowMs = () => Date.now()

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Number(process.env.PUSHBOT_FETCH_TIMEOUT_MS || 15000)),
    headers: {
      'user-agent': 'dsh-pushbot/0.1 (DeepSeek Harness resident service)',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return await response.text()
}

async function collectSource(source) {
  if (source.kind === 'rss' || source.kind === 'atom') {
    const xml = await fetchText(source.url)
    return parseFeed(xml).slice(0, source.limit ?? 10)
  }
  if (source.kind === 'github') {
    const repo = source.repo
    if (!repo) throw new Error('github source requires "repo"')
    const limit = source.limit ?? 3
    const events = Array.isArray(source.events) && source.events.length ? source.events : ['release']
    const items = []
    for (const event of events) {
      if (event === 'release') {
        const rows = JSON.parse(await fetchText(
          `https://api.github.com/repos/${repo}/releases?per_page=${limit}`,
          { headers: { accept: 'application/vnd.github+json' } },
        ))
        for (const row of rows) {
          items.push({
            id: `gh-release:${repo}:${row.id}`,
            title: `${repo} 发布 ${row.tag_name || row.name || ''}`.trim(),
            url: row.html_url,
            date: row.published_at,
            summary: stripTags(row.body || '').slice(0, 160),
          })
        }
      } else if (event === 'commit') {
        const rows = JSON.parse(await fetchText(
          `https://api.github.com/repos/${repo}/commits?per_page=${limit}`,
          { headers: { accept: 'application/vnd.github+json' } },
        ))
        for (const row of rows) {
          items.push({
            id: `gh-commit:${repo}:${row.sha}`,
            title: `${repo} 新提交 ${row.sha.slice(0, 7)}: ${(row.commit?.message || '').split('\n')[0].slice(0, 80)}`,
            url: row.html_url,
            date: row.commit?.author?.date,
          })
        }
      } else {
        throw new Error(`unsupported github event: ${event}`)
      }
    }
    return items
  }
  throw new Error(`unsupported source kind: ${source.kind}`)
}

function localPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT, value)
}

async function notify(notifierId, notifiers, text) {
  const notifier = notifiers?.[notifierId] || { kind: 'console' }
  if (notifier.kind === 'console') {
    log('notify(console):', text.replace(/\n/g, ' | '))
    return
  }
  if (notifier.kind === 'file') {
    await appendFile(localPath(notifier.path || 'data/notifications.log'), `\n## ${new Date().toISOString()}\n${text}\n`)
    return
  }
  if (notifier.kind === 'feishu-webhook') {
    const response = await fetch(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`feishu webhook HTTP ${response.status}`)
    const payload = await response.json().catch(() => ({}))
    if (payload.code && payload.code !== 0) throw new Error(`feishu webhook code ${payload.code} ${payload.msg || ''}`)
    return
  }
  if (notifier.kind === 'webhook') {
    const response = await fetch(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(notifier.headers || {}) },
      body: JSON.stringify(notifier.body === undefined ? { text } : notifier.body),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`webhook HTTP ${response.status}`)
    return
  }
  throw new Error(`unsupported notifier kind: ${notifier.kind}`)
}

export function apply(ctx) {
  let disposed = false
  let running = false
  const runtime = { lastCycleAt: null, lastDeliveryAt: null, sourcesOk: 0, sourcesFailed: 0, deliveries: 0 }
  log(`starting v${VERSION} root=${ROOT} config=${CONFIG_PATH} tick=${TICK_MS}ms runOnce=${RUN_ONCE}`)

  async function writeHealth(phase, extra = {}) {
    const memory = process.memoryUsage()
    const buildManifest = await readJson(path.join(ROOT, "versions", "current", "manifest.json"), null)
    await writeJsonAtomic(HEALTH_PATH, {
      ok: phase !== 'error',
      phase,
      version: VERSION,
      pid: process.pid,
      startedAt: STARTED_AT,
      lastCycleAt: runtime.lastCycleAt,
      lastDeliveryAt: runtime.lastDeliveryAt,
      sources: { ok: runtime.sourcesOk, failing: runtime.sourcesFailed },
      deliveries: runtime.deliveries,
      rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      build: buildManifest?.build ?? null,
      ...extra,
    }).catch((error) => log('health write failed:', error.message))
  }

  async function runCycle(reason) {
    if (running || disposed) return
    running = true
    runtime.sourcesOk = 0
    runtime.sourcesFailed = 0
    try {
      const config = await readJson(CONFIG_PATH, null)
      if (!config || !Array.isArray(config.topics)) {
        log(`no usable config at ${CONFIG_PATH}; waiting`)
        await writeHealth('idle', { reason })
        return
      }
      const state = await readJson(STATE_PATH, { topics: {} })
      state.topics ??= {}
      let freshTotal = 0
      for (const topic of config.topics) {
        const topicState = state.topics[topic.id] = state.topics[topic.id] || { seen: [], lastRunAt: 0 }
        if (!isDue(topicState, topic)) continue
        if (inQuietHours(topic)) { topicState.lastRunAt = nowMs(); continue }

        const collected = []
        for (const source of topic.sources || []) {
          try {
            collected.push(...await collectSource(source))
            runtime.sourcesOk += 1
          } catch (error) {
            runtime.sourcesFailed += 1
            log(`source failed topic=${topic.id} kind=${source.kind}: ${error.message}`)
          }
        }
        const seen = new Set(topicState.seen || [])
        const fresh = collected.filter((item) => item.id && !seen.has(item.id))
        topicState.seen = [...seen, ...fresh.map((item) => item.id)].slice(-500)
        topicState.lastRunAt = nowMs()
        if (!fresh.length) continue

        freshTotal += fresh.length
        try {
          await notify(topic.notifier, config.notifiers, formatDigest(topic, fresh))
          runtime.lastDeliveryAt = new Date().toISOString()
          runtime.deliveries += 1
          log(`delivered topic=${topic.id} items=${fresh.length} notifier=${topic.notifier || 'console'}`)
        } catch (error) {
          log(`delivery failed topic=${topic.id}: ${error.message}`)
        }
      }
      await writeJsonAtomic(STATE_PATH, state)
      runtime.lastCycleAt = new Date().toISOString()
      await writeHealth('ok', { freshTotal, reason })
      if (freshTotal === 0) log('cycle done, nothing new')
    } catch (error) {
      await writeHealth('error', { error: String(error?.message || error) })
      log('cycle error:', error?.stack || String(error))
    } finally {
      running = false
    }
  }

  const disposeTimer = ctx.timer.interval(() => { void runCycle('tick') }, TICK_MS)
  ctx.effect(() => () => {
    disposed = true
    disposeTimer()
    log('stopped')
  })

  void (async () => {
    await writeHealth('starting')
    if (RUN_ONCE) {
      await runCycle('run-once')
      const health = await readJson(HEALTH_PATH, {})
      log('run-once finished:', JSON.stringify(health))
      process.exit(0)
    }
    await runCycle('startup')
  })()
}
