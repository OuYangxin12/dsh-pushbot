import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dueEntries, emptyOutbox, enqueue, markFailed, markSent, pendingCount,
} from '../lib/outbox.js'

const entry = (id, text = 'body') => ({ id, topicId: 'topic', notifier: 'file', text })

test('enqueue adds a pending entry that is immediately due', () => {
  const outbox = enqueue(emptyOutbox(), entry('a'), 1000)
  assert.equal(pendingCount(outbox), 1)
  assert.equal(dueEntries(outbox, 1000).length, 1)
  assert.equal(outbox.pending[0].attempts, 0)
})

test('markSent removes the entry', () => {
  const outbox = enqueue(emptyOutbox(), entry('a'), 1000)
  markSent(outbox, 'a')
  assert.equal(pendingCount(outbox), 0)
})

test('markFailed schedules a backoff retry and keeps the entry', () => {
  const outbox = enqueue(emptyOutbox(), entry('a'), 1000)
  markFailed(outbox, 'a', new Error('boom'), 1000, 8, (n) => n * 1000)
  const row = outbox.pending[0]
  assert.equal(row.attempts, 1)
  assert.equal(row.nextAttemptAt, 2000)
  assert.match(row.lastError, /boom/)
  assert.equal(dueEntries(outbox, 1500).length, 0)
  assert.equal(dueEntries(outbox, 2000).length, 1)
})

test('markFailed moves the entry to dead after the attempt budget', () => {
  const outbox = enqueue(emptyOutbox(), entry('a'), 0)
  for (let i = 0; i < 3; i += 1) markFailed(outbox, 'a', 'x', 0, 3)
  assert.equal(pendingCount(outbox), 0)
  assert.equal(outbox.dead.length, 1)
  assert.equal(outbox.dead[0].attempts, 3)
})

test('markFailed on an unknown id is a no-op', () => {
  const outbox = enqueue(emptyOutbox(), entry('a'), 0)
  markFailed(outbox, 'missing', 'x')
  assert.equal(pendingCount(outbox), 1)
})
