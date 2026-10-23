import test from 'node:test'
import assert from 'node:assert/strict'
import { collectSource, sourceKey } from '../lib/sources.js'

const json = (value) => async () => value
const text = (value) => async () => value

test('sourceKey distinguishes kind, identity and events', () => {
  assert.equal(sourceKey({ kind: 'rss', url: 'u' }), 'rss|u|')
  assert.equal(sourceKey({ kind: 'github', repo: 'a/b', events: ['release'] }), 'github|a/b|release')
  assert.notEqual(sourceKey({ kind: 'rss', url: 'u' }), sourceKey({ kind: 'rss', url: 'v' }))
})

test('rss source parses and labels items', async () => {
  const { items } = await collectSource(
    { kind: 'rss', url: 'https://feed', name: '博客' },
    { fetchText: text('<rss><channel><item><title>A</title><link>https://a</link></item></channel></rss>') },
  )
  assert.equal(items.length, 1)
  assert.equal(items[0].source, '博客')
})

test('github releases become items and pass the token header', async () => {
  let seenHeaders
  const { items } = await collectSource(
    { kind: 'github', repo: 'o/r', events: ['release'], limit: 2 },
    {
      token: 'tok',
      fetchJson: async (_url, init) => {
        seenHeaders = init?.headers
        return [{ id: 7, tag_name: 'v1', html_url: 'https://gh/r/7', published_at: '2026-10-23T00:00:00Z', body: 'notes' }]
      },
    },
  )
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'gh-release:o/r:7')
  assert.match(items[0].title, /v1/)
  assert.equal(seenHeaders.authorization, 'Bearer tok')
})

test('hackernews fetches the top list then each item', async () => {
  const calls = []
  const { items } = await collectSource(
    { kind: 'hackernews', limit: 2, name: 'HN' },
    {
      fetchJson: async (url) => {
        calls.push(url)
        if (url.endsWith('topstories.json')) return [1, 2, 3]
        const id = Number(url.match(/item\/(\d+)\.json/)[1])
        return id === 1 ? { id: 1, title: 'first', time: 1700000000 } : null
      },
    },
  )
  assert.equal(calls.length, 3)
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'first')
})

test('hn-search builds a recency-filtered query', async () => {
  let calledUrl
  const { items } = await collectSource(
    { kind: 'hn-search', query: 'deepseek', limit: 5, sinceDays: 2 },
    {
      now: 1_700_000_000_000,
      fetchJson: async (url) => {
        calledUrl = url
        return { hits: [{ objectID: '9', title: 'T', url: 'https://t', created_at: '2026-10-23T00:00:00Z' }] }
      },
    },
  )
  assert.match(calledUrl, /query=deepseek/)
  assert.match(calledUrl, /hitsPerPage=5/)
  assert.match(calledUrl, /numericFilters=created_at_i>/)
  assert.equal(items.length, 1)
})

test('v2ex maps hot topics', async () => {
  const { items } = await collectSource(
    { kind: 'v2ex', limit: 5 },
    { fetchJson: json([{ id: 3, title: 'hot', url: 'https://v2ex/t/3', created: 1700000000 }]) },
  )
  assert.equal(items[0].id, 'v2ex:3')
  assert.equal(items[0].title, 'hot')
})

test('page: first observation is a silent baseline', async () => {
  const { items, state } = await collectSource(
    { kind: 'page', url: 'https://shop/item', name: '商品页' },
    { fetchText: text('<html><body>价格 199</body></html>'), now: 1000 },
  )
  assert.equal(items.length, 0)
  assert.equal(state.hash.length, 64)
})

test('page: a changed hash produces exactly one item', async () => {
  const { items, state } = await collectSource(
    { kind: 'page', url: 'https://shop/item', name: '商品页' },
    { fetchText: text('<html><body>价格 149</body></html>'), previous: { hash: 'stale' }, now: 2000 },
  )
  assert.equal(items.length, 1)
  assert.match(items[0].title, /内容有变化/)
  assert.match(items[0].summary, /价格 149/)
  assert.notEqual(state.hash, 'stale')
})

test('page: identical content produces no item', async () => {
  const html = '<html><body>价格 199</body></html>'
  const first = await collectSource({ kind: 'page', url: 'u' }, { fetchText: text(html), now: 1 })
  const second = await collectSource({ kind: 'page', url: 'u' }, { fetchText: text(html), previous: first.state, now: 2 })
  assert.equal(second.items.length, 0)
})

test('page expect.contains warns when the phrase disappears', async () => {
  const { items } = await collectSource(
    { kind: 'page', url: 'u', name: '库存', expect: { contains: '现货' } },
    { fetchText: text('<html><body>已售罄</body></html>'), now: 1 },
  )
  assert.equal(items.length, 1)
  assert.match(items[0].title, /未找到/)
})

test('page expect.absent warns when the banned phrase appears', async () => {
  const { items } = await collectSource(
    { kind: 'page', url: 'u', name: '库存', expect: { absent: '缺货' } },
    { fetchText: text('<html><body>缺货中</body></html>'), now: 1 },
  )
  assert.equal(items.length, 1)
  assert.match(items[0].title, /出现/)
})

test('page expect passes silently when satisfied', async () => {
  const { items } = await collectSource(
    { kind: 'page', url: 'u', expect: { contains: '现货', absent: '缺货' } },
    { fetchText: text('<html><body>现货充足</body></html>'), now: 1 },
  )
  assert.equal(items.length, 0)
})

test('unsupported source kind throws', async () => {
  await assert.rejects(collectSource({ kind: 'nope' }, {}), /unsupported source kind/)
})
