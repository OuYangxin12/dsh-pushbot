import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  parseFeed, stripTags, inQuietHours, isDue, formatDigest, minutesOfDay,
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
