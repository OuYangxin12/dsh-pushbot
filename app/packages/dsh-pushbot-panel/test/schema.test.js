import test from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig, SOURCE_KINDS } from '../schema.js'

const previous = {
  notifiers: {
    'feishu-app': { kind: 'feishu-app', appId: 'cli_x', openId: 'ou_x', appSecretEnv: 'FEISHU_APP_SECRET' },
    file: { kind: 'file', path: 'data/out.log' },
  },
  topics: [{ id: 'old', name: 'old', notifier: 'feishu-app', sources: [{ kind: 'rss', url: 'x' }] }],
  extra: { keep: true },
}

const draft = (over = {}) => ({
  topics: [{ id: 'ai', name: 'AI 资讯', everyMinutes: 15, notifier: 'feishu-app',
    sources: [{ kind: 'rss', url: 'https://a/feed.xml', limit: 5 }],
    quietHours: ['23:30', '07:30'], filter: { includeAny: ['AI'], excludeAny: ['招聘'] } }],
  ...over,
})

test('accepts a well-formed document and preserves on-disk notifiers', () => {
  const { errors, config } = validateConfig(draft(), { previous })
  assert.deepEqual(errors, [])
  assert.equal(config.topics[0].everyMinutes, 15)
  assert.deepEqual(config.topics[0].quietHours, ['23:30', '07:30'])
  assert.deepEqual(config.topics[0].filter, { includeAny: ['AI'], excludeAny: ['招聘'] })
  assert.equal(config.notifiers['feishu-app'].kind, 'feishu-app')
  assert.deepEqual(config.extra, { keep: true })
})

test('ignores notifier changes coming from the panel', () => {
  const { config } = validateConfig(draft({ notifiers: { evil: { kind: 'webhook', url: 'x' } } }), { previous })
  assert.equal(config.notifiers.evil, undefined)
  assert.ok(config.notifiers.file)
})

test('drops unknown source kinds and sources missing required fields', () => {
  const { errors, config } = validateConfig(draft({
    topics: [{ id: 't', name: 'T', notifier: 'file', sources: [
      { kind: 'rss' },
      { kind: 'telepathy', url: 'x' },
      { kind: 'html-list', url: 'https://x', title: '<h2>(.*)</h2>' },
    ] }],
  }), { previous })
  assert.deepEqual(errors, [])
  assert.equal(config.topics[0].sources.length, 1)
  assert.equal(config.topics[0].sources[0].kind, 'html-list')
})

test('rejects a topic with no usable source', () => {
  const { errors, config } = validateConfig(draft({ topics: [{ id: 't', name: 'T', sources: [] }] }), { previous })
  assert.match(errors.join(';'), /至少一个合法源/)
  assert.equal(config, null)
})

test('falls back to a valid notifier when the referenced one is gone', () => {
  const { config } = validateConfig(draft({ topics: [{ id: 't', name: 'T', notifier: 'gone', sources: [{ kind: 'v2ex' }] }] }), { previous })
  assert.equal(config.topics[0].notifier, 'feishu-app')
})

test('clamps intervals and item limits', () => {
  const { config } = validateConfig(draft({
    topics: [{ id: 't', name: 'T', everyMinutes: 9999, maxItemsPerRun: 500, maxItemsPerPush: 0,
      sources: [{ kind: 'hackernews', limit: 99 }] }],
  }), { previous })
  assert.equal(config.topics[0].everyMinutes, 1440)
  assert.equal(config.topics[0].maxItemsPerRun, 100)
  assert.equal(config.topics[0].maxItemsPerPush, 1)
  assert.equal(config.topics[0].sources[0].limit, 50)
})

test('de-duplicates colliding topic ids', () => {
  const { config } = validateConfig(draft({ topics: [
    { id: 'dup', name: 'A', sources: [{ kind: 'v2ex' }] },
    { id: 'dup', name: 'B', sources: [{ kind: 'v2ex' }] },
  ] }), { previous })
  assert.deepEqual(config.topics.map((t) => t.id), ['dup', 'dup-2'])
})

test('normalises llm, dailyReport and automation', () => {
  const { errors, config } = validateConfig(draft({
    llm: { enabled: true, model: 'deepseek-chat', maxCallsPerDay: 999 },
    dailyReport: { at: '08:30', notifier: 'file' },
    automation: { improve: 'approval' },
  }), { previous })
  assert.deepEqual(errors, [])
  assert.equal(config.llm.enabled, true)
  assert.equal(config.llm.maxCallsPerDay, 500)
  assert.deepEqual(config.dailyReport, { at: '08:30', notifier: 'file' })
  assert.equal(config.automation.improve, 'approval')
})

test('reports a bad dailyReport time and falls back to 09:00', () => {
  const { errors, config } = validateConfig(draft({ dailyReport: { at: '25:99', notifier: 'file' } }), { previous })
  assert.equal(config, null)
  assert.match(errors.join(';'), /HH:MM/)
})

test('null dailyReport removes the section', () => {
  const { config } = validateConfig(draft({ dailyReport: null }), { previous: { ...previous, dailyReport: { at: '09:00', notifier: 'file' } } })
  assert.equal(config.dailyReport, undefined)
})

test('invalid quiet hours and empty filters are dropped', () => {
  const { config } = validateConfig(draft({
    topics: [{ id: 't', name: 'T', sources: [{ kind: 'v2ex' }], quietHours: ['7:00', 'x'], filter: { includeAny: [] } }],
  }), { previous })
  assert.equal(config.topics[0].quietHours, undefined)
  assert.equal(config.topics[0].filter, undefined)
})

test('every advertised source kind is documented in the schema', () => {
  for (const kind of ['rss', 'atom', 'github', 'github-search', 'hackernews', 'hn-search', 'v2ex', 'page', 'html-list', 'json-api']) {
    assert.ok(SOURCE_KINDS[kind], `missing ${kind}`)
  }
})

test('includeAll groups survive a panel save', () => {
  const { errors, config } = validateConfig(draft({
    topics: [{
      id: 't', name: 'T', sources: [{ kind: 'v2ex' }],
      filter: { includeAll: [['ai', '模型'], ['降价', 'pricing']], excludeAny: ['招聘'] },
    }],
  }), { previous })
  assert.deepEqual(errors, [])
  assert.deepEqual(config.topics[0].filter.includeAll, [['ai', '模型'], ['降价', 'pricing']])
  assert.deepEqual(config.topics[0].filter.excludeAny, ['招聘'])
})
