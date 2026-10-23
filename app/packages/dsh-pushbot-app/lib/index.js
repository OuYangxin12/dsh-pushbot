/**
 * dsh-pushbot — resident headless watch & notify plugin for DeepSeek Harness.
 *
 * Pipeline per tick:
 *   sources -> keyword filter -> dedup -> (optional) LLM digest -> outbox -> push
 * Every digest is enqueued before delivery, so failures are retried with
 * exponential backoff instead of being lost. Heartbeat and metrics are written
 * to data/health.json for the external watchdog; there is no HTTP server.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import {
  applyFilter, buildFeishuBody, buildSummaryPrompt, cleanLlmText, fallbackSummary, formatDailyReport,
  inQuietHours, isDue, sortItems,
} from './core.js'
import { dueEntries, emptyOutbox, enqueue, markFailed, markSent, pendingCount } from './outbox.js'
import { collectSource, sourceKey } from './sources.js'

export const name = 'dsh-pushbot'
export const inject = ['timer']

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const CONFIG_PATH = process.env.PUSHBOT_CONFIG || path.join(ROOT, 'config.json')
const DATA_DIR = path.join(ROOT, 'data')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const OUTBOX_PATH = path.join(DATA_DIR, 'outbox.json')
const HEALTH_PATH = path.join(DATA_DIR, 'health.json')
const REPORTS_DIR = path.join(DATA_DIR, 'reports')
const TICK_MS = Number(process.env.PUSHBOT_TICK_MS || 30000)
const RUN_ONCE = process.env.PUSHBOT_RUN_ONCE === '1'
const VERSION = createRequire(import.meta.url)('../package.json').version
const STARTED_AT = new Date().toISOString()
const HISTORY_MAX = 500

const log = (...args) => console.log(new Date().toISOString(), '[pushbot]', ...args)
const nowMs = () => Date.now()
const todayKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

function githubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Number(process.env.PUSHBOT_FETCH_TIMEOUT_MS || 15000)),
    headers: {
      'user-agent': 'dsh-pushbot/0.2 (DeepSeek Harness resident service)',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response
}

async function fetchText(url, init) {
  return await (await request(url, init)).text()
}

async function fetchJson(url, init) {
  return await (await request(url, init)).json()
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
    const response = await request(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildFeishuBody(text, notifier.secret)),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload.code && payload.code !== 0) throw new Error(`feishu webhook code ${payload.code} ${payload.msg || ''}`)
    return
  }
  if (notifier.kind === 'webhook') {
    await request(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(notifier.headers || {}) },
      body: JSON.stringify(notifier.body === undefined ? { text } : notifier.body),
    })
    return
  }
  throw new Error(`unsupported notifier kind: ${notifier.kind}`)
}

/** Optional LLM digest; returns null so the caller falls back to the rule digest. */
async function summarize(topic, items, config, state) {
  const llm = config.llm
  if (!llm?.enabled) return null
  const key = process.env[llm.apiKeyEnv || 'PUSHBOT_LLM_API_KEY'] || llm.apiKey
  if (!key) return null
  const day = todayKey()
  state.llmCalls ??= {}
  if (Number(state.llmCalls[day] || 0) >= Number(llm.maxCallsPerDay ?? 20)) {
    log('llm budget exhausted for', day)
    return null
  }
  const baseUrl = String(llm.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
  try {
    const response = await request(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: llm.model || 'deepseek-chat',
        temperature: Number(llm.temperature ?? 0.3),
        max_tokens: Number(llm.maxTokens ?? 700),
        messages: [{ role: 'user', content: buildSummaryPrompt(topic, items) }],
      }),
    })
    const payload = await response.json()
    const text = cleanLlmText(payload?.choices?.[0]?.message?.content || '')
    state.llmCalls[day] = Number(state.llmCalls[day] || 0) + 1
    if (!text) return null
    return `【${topic.name || topic.id}】\n${text}`
  } catch (error) {
    log(`llm summary failed topic=${topic.id}: ${error.message}`)
    return null
  }
}

export function apply(ctx) {
  let disposed = false
  let running = false
  const runtime = {
    lastCycleAt: null, lastDeliveryAt: null,
    sourcesOk: 0, sourcesFailed: 0, deliveries: 0, failures: 0,
  }
  log(`starting v${VERSION} root=${ROOT} config=${CONFIG_PATH} tick=${TICK_MS}ms runOnce=${RUN_ONCE}`)

  async function writeHealth(phase, extra = {}) {
    const memory = process.memoryUsage()
    const build = await readJson(path.join(ROOT, 'versions', 'current', 'manifest.json'), null)
    const outbox = await readJson(OUTBOX_PATH, null)
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
      deliveryFailures: runtime.failures,
      outboxPending: outbox ? pendingCount(outbox) : 0,
      outboxDead: (outbox?.dead || []).length,
      rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
      build: build?.build ?? null,
      ...extra,
    }).catch((error) => log('health write failed:', error.message))
  }

  async function flushOutbox(config) {
    const outbox = await readJson(OUTBOX_PATH, emptyOutbox())
    const due = dueEntries(outbox, nowMs())
    for (const entry of due) {
      try {
        await notify(entry.notifier, config.notifiers, entry.text)
        markSent(outbox, entry.id)
        runtime.deliveries += 1
        runtime.lastDeliveryAt = new Date().toISOString()
        log(`delivered topic=${entry.topicId} attempt=${entry.attempts + 1}`)
      } catch (error) {
        runtime.failures += 1
        markFailed(outbox, entry.id, error)
        log(`delivery failed topic=${entry.topicId}: ${error.message}`)
      }
    }
    await writeJsonAtomic(OUTBOX_PATH, outbox)
    return outbox
  }

  async function writeDailyReport(config, state) {
    const daily = config.dailyReport
    if (!daily?.at) return null
    const now = new Date()
    const day = todayKey(now)
    if (state.lastDailyReport === day) return null
    const [hour, minute] = String(daily.at).split(':').map(Number)
    const dueAt = new Date(now)
    dueAt.setHours(hour || 0, minute || 0, 0, 0)
    if (now < dueAt) return null

    const entries = (state.history || []).filter((row) => todayKey(new Date(row.ts)) === day)
    const report = formatDailyReport(day, entries, {
      topics: new Set(entries.map((row) => row.topic)).size,
      sourcesOk: runtime.sourcesOk,
      sourcesFailed: runtime.sourcesFailed,
    })
    await mkdir(REPORTS_DIR, { recursive: true })
    await writeFile(path.join(REPORTS_DIR, `${day}.md`), report)
    state.lastDailyReport = day
    if (entries.length && daily.notifier) {
      enqueueNow(state, {
        id: `daily:${day}`,
        topicId: 'daily-report',
        notifier: daily.notifier,
        text: report.slice(0, 3500),
      })
    }
    log(`daily report written for ${day} entries=${entries.length}`)
    return report
  }

  const queuedThisCycle = []
  function enqueueNow(_state, entry) {
    queuedThisCycle.push(entry)
  }

  async function runCycle(reason) {
    if (running || disposed) return
    running = true
    runtime.sourcesOk = 0
    runtime.sourcesFailed = 0
    queuedThisCycle.length = 0
    try {
      const config = await readJson(CONFIG_PATH, null)
      if (!config || !Array.isArray(config.topics)) {
        log(`no usable config at ${CONFIG_PATH}; waiting`)
        await writeHealth('idle', { reason })
        return
      }
      const state = await readJson(STATE_PATH, { topics: {}, history: [], llmCalls: {} })
      state.topics ??= {}
      state.history ??= []
      state.llmCalls ??= {}
      const token = githubToken()
      let freshTotal = 0

      for (const topic of config.topics) {
        const topicState = state.topics[topic.id] = state.topics[topic.id] || { seen: [], lastRunAt: 0, sources: {} }
        topicState.sources ??= {}
        if (!isDue(topicState, topic)) continue
        if (inQuietHours(topic)) { topicState.lastRunAt = nowMs(); continue }

        const collected = []
        for (const source of topic.sources || []) {
          const key = sourceKey(source)
          try {
            const result = await collectSource(source, {
              fetchText, fetchJson, token,
              previous: topicState.sources[key],
              now: nowMs(),
            })
            if (result.state) topicState.sources[key] = result.state
            collected.push(...result.items)
            runtime.sourcesOk += 1
          } catch (error) {
            runtime.sourcesFailed += 1
            log(`source failed topic=${topic.id} kind=${source.kind}: ${error.message}`)
          }
        }

        const seen = new Set(topicState.seen || [])
        const unseen = collected.filter((item) => item.id && !seen.has(item.id))
        topicState.seen = [...seen, ...unseen.map((item) => item.id)].slice(-1000)
        topicState.lastRunAt = nowMs()

        const fresh = sortItems(applyFilter(unseen, topic)).slice(0, Number(topic.maxItemsPerRun ?? 20))
        if (!fresh.length) continue

        freshTotal += fresh.length
        const digest = (await summarize(topic, fresh, config, state)) || fallbackSummary(topic, fresh)
        const id = `digest:${topic.id}:${nowMs()}`
        queuedThisCycle.push({ id, topicId: topic.id, notifier: topic.notifier, text: digest })
        for (const item of fresh) {
          state.history.push({ ts: nowMs(), topic: topic.id, title: item.title, url: item.url })
        }
      }

      if (queuedThisCycle.length) {
        const outbox = await readJson(OUTBOX_PATH, emptyOutbox())
        for (const entry of queuedThisCycle) enqueue(outbox, entry, nowMs())
        await writeJsonAtomic(OUTBOX_PATH, outbox)
      }

      const dailyEntries = await writeDailyReport(config, state)
      if (dailyEntries) {
        const outbox = await readJson(OUTBOX_PATH, emptyOutbox())
        for (const entry of queuedThisCycle) if (entry.topicId === 'daily-report') enqueue(outbox, entry, nowMs())
        await writeJsonAtomic(OUTBOX_PATH, outbox)
      }

      state.history = state.history.slice(-HISTORY_MAX)
      await writeJsonAtomic(STATE_PATH, state)
      await flushOutbox(config)

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
      process.exit(health?.ok ? 0 : 1)
    }
    await runCycle('startup')
  })()
}
