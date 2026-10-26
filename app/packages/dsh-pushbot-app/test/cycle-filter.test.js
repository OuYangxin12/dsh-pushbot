/** A source marked bypassFilter must survive keyword filters that drop others. */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>一个和关键词无关的标题</title><link>https://example.com/a</link><guid>a1</guid></item>
</channel></rss>`

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

test('bypassFilter keeps page-monitor style items that keywords would drop', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' })
    res.end(FEED)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/feed.xml`

  const root = await mkdtemp(path.join(tmpdir(), 'pushbot-filter-'))
  await mkdir(path.join(root, 'data'), { recursive: true })
  const configPath = path.join(root, 'config.json')
  await writeFile(configPath, JSON.stringify({
    notifiers: { file: { kind: 'file', path: 'data/out.log' } },
    topics: [
      {
        id: 'filtered', name: '会被过滤的主题', everyMinutes: 1, notifier: 'file',
        filter: { includeAll: [['根本不存在的关键词']] },
        sources: [{ kind: 'rss', url, limit: 3 }],
      },
      {
        id: 'bypassed', name: '绕过过滤的主题', everyMinutes: 1, notifier: 'file',
        filter: { includeAll: [['根本不存在的关键词']] },
        sources: [{ kind: 'rss', url, limit: 3, bypassFilter: true }],
      },
    ],
  }, null, 2))

  process.env.PUSHBOT_ROOT = root
  process.env.PUSHBOT_CONFIG = configPath
  process.env.PUSHBOT_TICK_MS = '3600000'
  process.env.PUSHBOT_FETCH_TIMEOUT_MS = '2000'

  const { apply } = await import('../lib/index.js')
  apply({
    timer: { interval: () => () => {} },
    effect: (factory) => { const dispose = factory(); return () => dispose?.() },
  })

  const healthPath = path.join(root, 'data', 'health.json')
  assert.ok(await waitFor(async () => {
    const health = await readJson(healthPath, null)
    return health?.phase === 'ok' && Number(health?.deliveries || 0) >= 1
  }), 'the bypassed topic should deliver')

  const health = await readJson(healthPath, {})
  assert.equal(health.deliveries, 1, 'the filtered topic delivers nothing')

  const out = await readFile(path.join(root, 'data', 'out.log'), 'utf8')
  assert.match(out, /绕过过滤的主题/)
  assert.doesNotMatch(out, /会被过滤的主题/)

  await new Promise((resolve) => server.close(resolve))
})
