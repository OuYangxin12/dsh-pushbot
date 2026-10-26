/**
 * Integration test: run one real cycle through apply() against a local feed.
 *
 * Unit tests cover pure helpers; this covers the wiring that a refactor can
 * silently break (a removed stage, a missing import, a disabled topic).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>第一条</title><link>https://example.com/1</link><guid>g1</guid></item>
  <item><title>第二条</title><link>https://example.com/2</link><guid>g2</guid></item>
</channel></rss>`

async function startFeed() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' })
    res.end(FEED)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, url: `http://127.0.0.1:${port}/feed.xml` }
}

const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

test('one cycle fetches, dedups, delivers and skips disabled topics', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pushbot-cycle-'))
  await mkdir(path.join(root, 'data'), { recursive: true })
  const feed = await startFeed()
  const configPath = path.join(root, 'config.json')
  await writeFile(configPath, JSON.stringify({
    notifiers: { file: { kind: 'file', path: 'data/out.log' } },
    topics: [
      { id: 'live', name: '实时主题', everyMinutes: 1, notifier: 'file',
        sources: [{ kind: 'rss', url: feed.url, limit: 5 }] },
      // a disabled topic whose source would fail if it were fetched
      { id: 'paused', name: '暂停主题', disabled: true, everyMinutes: 1, notifier: 'file',
        sources: [{ kind: 'rss', url: 'http://127.0.0.1:1/never', limit: 5 }] },
    ],
  }, null, 2))

  process.env.PUSHBOT_ROOT = root
  process.env.PUSHBOT_CONFIG = configPath
  process.env.PUSHBOT_TICK_MS = '3600000'
  process.env.PUSHBOT_FETCH_TIMEOUT_MS = '2000'

  const { apply } = await import('../lib/index.js')
  const ticks = []
  apply({
    timer: { interval: (callback) => { ticks.push(callback); return () => {} } },
    effect: (factory) => { const dispose = factory(); return () => dispose?.() },
  })

  const healthPath = path.join(root, 'data', 'health.json')
  const ok = await waitFor(async () => {
    const health = await readJson(healthPath, null)
    return health?.phase === 'ok' && Number(health?.deliveries || 0) >= 1
  })
  assert.ok(ok, 'a cycle should finish and deliver')

  const health = await readJson(healthPath, {})
  assert.equal(health.sources.ok, 1, 'only the live topic is fetched')
  assert.equal(health.sources.failing, 0, 'the disabled topic is skipped, not failed')
  assert.equal(health.deliveries, 1)
  assert.equal(health.outboxPending, 0)

  const out = await readFile(path.join(root, 'data', 'out.log'), 'utf8')
  assert.match(out, /实时主题/)
  assert.match(out, /第一条/)
  assert.doesNotMatch(out, /暂停主题/)

  // a second tick must not re-deliver the same items
  await ticks[0]()
  await waitFor(async () => false, 300)
  const after = await readJson(healthPath, {})
  assert.equal(after.deliveries, 1, 'dedup keeps the second tick quiet')

  await new Promise((resolve) => feed.server.close(resolve))
})
