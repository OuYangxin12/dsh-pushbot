/**
 * Host half of the dsh-pushbot control panel.
 *
 * Reads and writes the pushbot data directory directly (both live on the same
 * machine) and controls the systemd user unit. The pushbot service itself stays
 * headless: this plugin is the only place that exposes an HTTP surface, and it
 * is fenced by Connection's Host/Origin checks plus a same-origin JSON body.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

export const name = 'dsh-pushbot-panel'
export const inject = ['webServer', 'connection']

const run = promisify(execFile)
const BASE = '/api/dsh-pushbot'

export function apply(ctx, config = {}) {
  const root = config.root || path.join(os.homedir(), 'pushbot')
  const unit = config.unit || 'dsh-pushbot'
  const configPath = path.join(root, 'config.json')
  const dataDir = path.join(root, 'data')

  const readJson = async (file, fallback) => {
    try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
  }
  const writeJson = async (file, value) => {
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`)
    await rename(tmp, file)
  }
  const systemctl = async (args) => {
    try {
      const { stdout } = await run('systemctl', ['--user', ...args], { timeout: 10000 })
      return stdout.trim()
    } catch (error) {
      return String(error?.stdout || error?.message || '').trim()
    }
  }

  async function serviceState() {
    const show = await systemctl(['show', '-p', 'ActiveState', '-p', 'SubState', '-p', 'MainPID', '-p', 'NRestarts', unit])
    const fields = Object.fromEntries(show.split('\n').filter(Boolean).map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    }))
    const enabled = await systemctl(['is-enabled', unit])
    const timersRaw = await systemctl(['list-timers', '--all', '--no-legend', `${unit}*`])
    const timers = timersRaw.split('\n').filter(Boolean).map((line) => {
      const parts = line.trim().split(/\s+/)
      return { next: `${parts[0] || ''} ${parts[1] || ''}`.trim(), unit: parts.at(-1) || '' }
    }).filter((timer) => timer.unit.includes(unit))
    return {
      active: fields.ActiveState || 'unknown',
      sub: fields.SubState || '',
      enabled: enabled || 'unknown',
      pid: Number(fields.MainPID || 0),
      restarts: Number(fields.NRestarts || 0),
      timers,
    }
  }

  async function overview() {
    const [config, health, state, outbox, deploys, improvements, service] = await Promise.all([
      readJson(configPath, { topics: [], notifiers: {} }),
      readJson(path.join(dataDir, 'health.json'), null),
      readJson(path.join(dataDir, 'state.json'), { topics: {}, history: [] }),
      readJson(path.join(dataDir, 'outbox.json'), { pending: [], dead: [] }),
      readJson(path.join(dataDir, 'deploys.json'), []),
      readJson(path.join(dataDir, 'improvements.json'), []),
      serviceState(),
    ])
    const topics = (config.topics || []).map((topic) => {
      const topicState = state?.topics?.[topic.id] || {}
      return {
        id: topic.id,
        name: topic.name || topic.id,
        everyMinutes: Number(topic.everyMinutes ?? 30),
        notifier: topic.notifier || 'console',
        disabled: topic.disabled === true,
        quietHours: topic.quietHours || null,
        sources: (topic.sources || []).map((source) => source.kind),
        sourceCount: (topic.sources || []).length,
        lastRunAt: topicState.lastRunAt || null,
        seen: (topicState.seen || []).length,
      }
    })
    const lastDeploy = (deploys || []).filter((row) => row.action === 'deploy').at(-1) || null
    const lastImprovement = (improvements || []).at(-1) || null
    return {
      root,
      configPath,
      service,
      health,
      topics,
      notifiers: Object.entries(config.notifiers || {}).map(([id, row]) => ({ id, kind: row.kind })),
      llm: { enabled: Boolean(config.llm?.enabled) },
      dailyReport: config.dailyReport || null,
      outbox: { pending: (outbox.pending || []).length, dead: (outbox.dead || []).length },
      recent: (state?.history || []).slice(-12).reverse(),
      lastDeploy,
      lastImprovement,
    }
  }

  /** Normalise a topic patch without trusting the panel for anything structural. */
  function applyTopicPatch(config, patch) {
    const byId = new Map((config.topics || []).map((topic) => [topic.id, topic]))
    for (const change of patch.topics || []) {
      const topic = byId.get(change.id)
      if (!topic) continue
      if (typeof change.disabled === 'boolean') {
        if (change.disabled) topic.disabled = true
        else delete topic.disabled
      }
      if (Number.isFinite(Number(change.everyMinutes))) {
        topic.everyMinutes = Math.max(1, Math.min(1440, Math.round(Number(change.everyMinutes))))
      }
      if (typeof change.notifier === 'string' && config.notifiers?.[change.notifier]) {
        topic.notifier = change.notifier
      }
    }
  }

  async function act(action, payload) {
    if (action === 'run-once') {
      run('bash', [path.join(root, 'ops', 'run-once.sh')], {
        timeout: 120000,
        env: { ...process.env, PUSHBOT_ROOT: root },
      }).catch(() => {})
      return { started: true, hint: '抓取已触发，约 10–30 秒后刷新状态' }
    }
    if (action === 'restart') {
      await systemctl(['restart', unit])
      return { started: true, hint: '服务已重启' }
    }
    if (action === 'test-push') {
      try {
        const { stdout } = await run('node', [path.join(root, 'ops', 'test-push.mjs')], {
          timeout: 30000,
          env: { ...process.env, PUSHBOT_ROOT: root },
        })
        return { ok: true, output: stdout.trim().split('\n').slice(-4).join('\n') }
      } catch (error) {
        return {
          ok: false,
          output: String(error?.stdout || '').trim().split('\n').slice(-4).join('\n'),
          error: String(error?.stderr || error?.message || '').trim().split('\n').slice(-3).join('\n'),
        }
      }
    }
    if (action === 'improve') {
      run('bash', [path.join(root, 'ops', 'improve.sh')], {
        timeout: 1800000,
        env: { ...process.env, PUSHBOT_ROOT: root },
      }).catch(() => {})
      return { started: true, hint: '自改进已触发，结果见 data/improve.log' }
    }
    throw Object.assign(new Error(`未知操作：${action}`), { status: 400 })
  }

  const json = (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }

  const readBody = async (req, limit = 256 * 1024) => {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 })
      chunks.push(chunk)
    }
    if (!chunks.length) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  /** Connection's Host/Origin + browser-auth fence; fail closed on any error. */
  const fenced = (req, res) => {
    try {
      const rejection = ctx.connection.requestRejection({ headers: req.headers })
      if (rejection) { res.writeHead(rejection); res.end(); return false }
      return true
    } catch {
      res.writeHead(403)
      res.end()
      return false
    }
  }

  const writeGuard = (req, res) => {
    if (req.method === 'GET') return true
    const type = String(req.headers['content-type'] || '')
    if (!type.includes('application/json')) { json(res, 415, { error: 'content-type must be application/json' }); return false }
    return true
  }

  const route = (pathname, handler) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${BASE}${pathname}`,
    handler: async (req, res) => {
      if (!fenced(req, res)) return
      if (!writeGuard(req, res)) return
      try {
        await handler(req, res)
      } catch (error) {
        json(res, Number(error?.status) || 500, { error: String(error?.message || error) })
      }
    },
  }), `dsh-pushbot-panel: ${pathname}`)

  route('/overview', async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    json(res, 200, await overview())
  })

  route('/config', async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    const patch = await readBody(req)
    const config = await readJson(configPath, null)
    if (!config) return json(res, 409, { error: `读不到 ${configPath}` })
    applyTopicPatch(config, patch)
    await writeJson(configPath, config)
    json(res, 200, { ok: true })
  })

  route('/action', async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    const body = await readBody(req)
    json(res, 200, await act(String(body.action || ''), body))
  })
}
