import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pushbot-panel-'))
  await mkdir(path.join(root, 'data'), { recursive: true })
  await writeFile(path.join(root, 'config.json'), JSON.stringify({
    notifiers: {
      file: { kind: 'file', path: 'data/out.log' },
      'feishu-app': { kind: 'feishu-app', appId: 'cli_x', openId: 'ou_x' },
    },
    topics: [
      { id: 'ai', name: 'AI 资讯', everyMinutes: 30, notifier: 'feishu-app', sources: [{ kind: 'rss', url: 'u' }] },
      { id: 'gh', name: '仓库', everyMinutes: 60, notifier: 'feishu-app', sources: [{ kind: 'github', repo: 'o/r' }] },
    ],
  }, null, 2))
  await writeFile(path.join(root, 'data', 'health.json'), JSON.stringify({
    ok: true, phase: 'ok', version: '0.6.0', build: 9, deliveries: 4, deliveryFailures: 1,
    sources: { ok: 3, failing: 0 }, outboxPending: 0, rssMb: 150, lastCycleAt: '2026-10-26T03:00:00.000Z',
  }))
  await writeFile(path.join(root, 'data', 'state.json'), JSON.stringify({
    topics: { ai: { seen: ['a', 'b'], lastRunAt: 1790000000000 } },
    history: [{ ts: 1790000000000, topic: 'ai', title: '标题', url: 'https://e' }],
  }))
  await writeFile(path.join(root, 'data', 'outbox.json'), JSON.stringify({ pending: [], dead: [{ id: 'x' }] }))
  const routes = []
  const ctx = {
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    connection: { requestRejection: () => undefined },
  }
  apply(ctx, { root, unit: 'dsh-pushbot-test' })
  return { root, routes }
}

function call(route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
    }
    const res = {
      statusCode: 200,
      headers: {},
      writeHead(status, headers2) { this.statusCode = status; Object.assign(this.headers, headers2 || {}); return this },
      end(chunk) { resolve({ status: this.statusCode, json: chunk ? JSON.parse(chunk) : undefined }) },
    }
    route.handler(req, res)
  })
}

test('registers the three panel routes under /api/dsh-pushbot', async () => {
  const { routes } = await fixture()
  assert.deepEqual(routes.map((r) => r.path), [
    '/api/dsh-pushbot/overview',
    '/api/dsh-pushbot/config',
    '/api/dsh-pushbot/action',
  ])
})

test('overview reports service state, topics and outbox', async () => {
  const { routes } = await fixture()
  const result = await call(routes[0])
  assert.equal(result.status, 200)
  assert.equal(result.json.health.phase, 'ok')
  assert.equal(result.json.topics.length, 2)
  assert.equal(result.json.topics[0].seen, 2)
  assert.equal(result.json.topics[1].seen, 0)
  assert.deepEqual(result.json.outbox, { pending: 0, dead: 1 })
  assert.equal(result.json.recent[0].title, '标题')
  assert.equal(result.json.schemaVersion, 2)
  assert.deepEqual(Object.keys(result.json.config.notifiers), ['file', 'feishu-app'])
  assert.equal(result.json.config.topics.length, 2)
  assert.ok(result.json.catalog.sourceKinds.some((row) => row.kind === 'json-api'))
})

test('config route writes a validated document', async () => {
  const { root, routes } = await fixture()
  const current = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'))
  const result = await call(routes[1], {
    method: 'POST',
    body: { config: {
      topics: [
        { ...current.topics[0], everyMinutes: 15, disabled: true },
        { ...current.topics[1], notifier: 'file', everyMinutes: 9999 },
      ],
      llm: { enabled: true, maxCallsPerDay: 9 },
      automation: { improve: 'approval' },
    } },
  })
  assert.equal(result.status, 200)
  const saved = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'))
  assert.equal(saved.topics[0].everyMinutes, 15)
  assert.equal(saved.topics[0].disabled, true)
  assert.equal(saved.topics[1].notifier, 'file')
  assert.equal(saved.topics[1].everyMinutes, 1440, 'interval is clamped to a day')
})

test('config route rejects an invalid document with 422', async () => {
  const { routes } = await fixture()
  const result = await call(routes[1], { method: 'POST', body: { config: { topics: [{ id: 'nope', name: 'x', sources: [] }] } } })
  assert.equal(result.status, 422)
  assert.match(result.json.error, /至少一个合法源/)
})

test('write routes demand a JSON content type', async () => {
  const { routes } = await fixture()
  const result = await call(routes[1], { method: 'POST', headers: { 'content-type': 'text/plain' } })
  assert.equal(result.status, 415)
})

test('unknown actions report 400 and the reason', async () => {
  const { routes } = await fixture()
  const result = await call(routes[2], { method: 'POST', body: { action: 'self-destruct' } })
  assert.equal(result.status, 400)
  assert.match(result.json.error, /未知操作/)
})

test('the connection fence rejection short-circuits the route', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pushbot-panel-'))
  const routes = []
  apply({
    effect: (fn) => fn(),
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    connection: { requestRejection: () => 401 },
  }, { root, unit: 'x' })
  let body
  await new Promise((resolve) => {
    routes[0].handler(
      { method: 'GET', headers: {} },
      { writeHead() { this.statusCode = 401 }, end(chunk) { body = chunk; resolve() } },
    )
  })
  assert.equal(body, undefined, 'fenced requests never reach the handler')
})
