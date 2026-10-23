import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  applyFilter, backoffMs, buildFeishuBody, cleanLlmText, fallbackSummary, feishuSign, formatDailyReport, formatDigest,
  hashText, inQuietHours, isDue, minutesOfDay, normalizePage, parseFeed, parseHnSearch,
  sortItems, stripTags,
} from '../lib/core.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8')

test('CDATA titles survive tag stripping (regression)', () => {
  assert.equal(stripTags('<![CDATA[Hello <b>world</b>]]>'), 'Hello world')
  const items = parseFeed(fixture('hnrss.xml'))
  assert.equal(items[0].title, 'The same AI request emits 8.5x more CO2')
})

test('RSS items: title, link, guid, date, summary', () => {
  const items = parseFeed(fixture('hnrss.xml'))
  assert.equal(items.length, 2)
  assert.equal(items[0].id, 'https://news.ycombinator.com/item?id=1')
  assert.equal(items[0].url, 'https://example.com/a')
  assert.equal(items[0].date, '2026-10-23T08:00:00.000Z')
  assert.equal(items[0].summary, 'Some summary text')
  assert.equal(items[1].title, 'Plain & simple')
})

test('Atom entries use href links and updated time', () => {
  const items = parseFeed(fixture('atom.xml'))
  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Atom entry')
  assert.equal(items[0].url, 'https://example.com/atom-1')
  assert.equal(items[0].id, 'urn:uuid:1')
  assert.equal(items[0].date, '2026-10-23T08:00:00.000Z')
})

test('quiet hours: normal and cross-midnight windows', () => {
  const at = (h, m) => new Date(2026, 9, 23, h, m)
  assert.equal(inQuietHours({ quietHours: ['23:30', '07:30'] }, at(2, 0)), true)
  assert.equal(inQuietHours({ quietHours: ['23:30', '07:30'] }, at(12, 0)), false)
  assert.equal(inQuietHours({ quietHours: ['09:00', '18:00'] }, at(10, 0)), true)
  assert.equal(inQuietHours({ quietHours: ['09:00', '18:00'] }, at(20, 0)), false)
  assert.equal(inQuietHours({}, at(1, 0)), false)
  assert.equal(minutesOfDay('07:30'), 450)
})

test('isDue honours per-topic interval', () => {
  const now = 10_000_000
  assert.equal(isDue({ lastRunAt: now - 30 * 60000 }, { everyMinutes: 30 }, now), true)
  assert.equal(isDue({ lastRunAt: now - 29 * 60000 }, { everyMinutes: 30 }, now), false)
  assert.equal(isDue({}, { everyMinutes: 1 }, now), true)
})

test('digest truncates and reports the remainder', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ title: `t${i + 1}`, url: `https://e/${i}` }))
  const text = formatDigest({ name: 'T', maxItemsPerPush: 3 }, items)
  assert.match(text, /【T】5 条新内容/)
  assert.match(text, /1\. t1/)
  assert.match(text, /3\. t3/)
  assert.match(text, /另有 2 条未列出/)
  assert.doesNotMatch(text, /4\. t4/)
})

test('digest adds a source label when present', () => {
  const text = formatDigest({ name: 'T' }, [{ title: 'x', source: 'HN' }])
  assert.match(text, /1\. \[HN\] x/)
})

test('sortItems is newest-first and stable without dates', () => {
  const sorted = sortItems([
    { title: 'old', date: '2026-10-01T00:00:00Z' },
    { title: 'none' },
    { title: 'new', date: '2026-10-20T00:00:00Z' },
  ])
  assert.deepEqual(sorted.map((i) => i.title), ['new', 'old', 'none'])
})

test('applyFilter honours includeAny and excludeAny', () => {
  const items = [
    { title: 'DeepSeek 发布新模型' },
    { title: '招聘信息：前端工程师' },
    { title: 'OpenAI 发布会', summary: 'deepseek 对比' },
  ]
  assert.equal(applyFilter(items, { filter: { includeAny: ['deepseek'] } }).length, 2)
  assert.equal(applyFilter(items, { filter: { excludeAny: ['招聘'] } }).length, 2)
  assert.equal(applyFilter(items, { filter: { includeAny: ['deepseek'], excludeAny: ['openai'] } }).length, 1)
  assert.equal(applyFilter(items, {}).length, 3)
})

test('backoffMs grows exponentially and is capped', () => {
  assert.equal(backoffMs(1), 60000)
  assert.equal(backoffMs(2), 120000)
  assert.equal(backoffMs(3), 240000)
  assert.equal(backoffMs(20), 1800000)
})

test('normalizePage drops scripts, styles and comment noise', () => {
  const html = `<html><head><style>.a{color:red}</style><script>var x=1</script></head>
    <body><!-- tracker --><h1>现货</h1><p>价格 199</p><div>  多余   空格 </div></body></html>`
  const text = normalizePage(html)
  assert.doesNotMatch(text, /var x/)
  assert.doesNotMatch(text, /color:red/)
  assert.doesNotMatch(text, /tracker/)
  assert.match(text, /现货/)
  assert.match(text, /价格 199/)
  assert.doesNotMatch(text, /  +/)
})

test('hashText is stable and content-sensitive', () => {
  assert.equal(hashText('a'), hashText('a'))
  assert.notEqual(hashText('a'), hashText('b'))
  assert.equal(hashText('a').length, 64)
})

test('parseHnSearch maps hits and skips empty rows', () => {
  const items = parseHnSearch({
    hits: [
      { objectID: '1', title: 'A', url: 'https://a', created_at: '2026-10-23T00:00:00Z' },
      { objectID: '2', story_title: 'B', story_url: 'https://b' },
      { objectID: '3' },
    ],
  }, 'HN搜索')
  assert.equal(items.length, 2)
  assert.equal(items[0].id, 'hn-search:1')
  assert.equal(items[1].title, 'B')
  assert.equal(items[1].url, 'https://b')
  assert.equal(items[1].source, 'HN搜索')
})

test('cleanLlmText strips fences and labels', () => {
  assert.equal(cleanLlmText('```\n· 事实\n```'), '· 事实')
  assert.equal(cleanLlmText('简报：· 事实'), '· 事实')
})

test('fallbackSummary equals the rule digest', () => {
  const topic = { name: 'T' }
  const items = [{ title: 'a', url: 'https://a' }]
  assert.equal(fallbackSummary(topic, items), formatDigest(topic, items))
})

test('formatDailyReport groups by topic and handles empty days', () => {
  const report = formatDailyReport('2026-10-23', [
    { topic: 'ai', title: 'A', url: 'https://a' },
    { topic: 'ai', title: 'B' },
    { topic: 'gh', title: 'C', url: 'https://c' },
  ], { topics: 2, sourcesOk: 5, sourcesFailed: 1 })
  assert.match(report, /# 2026-10-23 推送日报/)
  assert.match(report, /## ai（2）/)
  assert.match(report, /## gh（1）/)
  assert.match(report, /新内容条数：3/)
  assert.match(report, /抓取成功\/失败：5\/1/)
  const empty = formatDailyReport('2026-10-24', [])
  assert.match(empty, /今日没有新内容/)
})

test('feishu signing matches the documented algorithm', () => {
  assert.equal(feishuSign('test-secret', '1700000000'), 'mbm4Y4oluIPQ00qlBIhX8vAZ0EKv3nw0LuTb91jPL84=')
  assert.notEqual(feishuSign('other', '1700000000'), feishuSign('test-secret', '1700000000'))
  assert.notEqual(feishuSign('test-secret', '1700000001'), feishuSign('test-secret', '1700000000'))
  assert.match(feishuSign('s', '1'), /^[A-Za-z0-9+/]+=*$/ )
})

test('buildFeishuBody omits the signature when no secret is set', () => {
  assert.deepEqual(buildFeishuBody('hi', undefined, 1700000000), { msg_type: 'text', content: { text: 'hi' } })
})

test('buildFeishuBody signs when a secret is present', () => {
  const signed = buildFeishuBody('hi', 'test-secret', 1700000000)
  assert.equal(signed.content.text, 'hi')
  assert.equal(signed.timestamp, '1700000000')
  assert.equal(signed.sign, feishuSign('test-secret', '1700000000'))
})
