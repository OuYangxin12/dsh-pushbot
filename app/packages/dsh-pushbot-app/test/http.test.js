import test from 'node:test'
import assert from 'node:assert/strict'
import { retryAsync } from '../lib/http.js'

test('retryAsync returns as soon as the task succeeds', async () => {
  let calls = 0
  const value = await retryAsync(async () => {
    calls += 1
    if (calls < 3) throw new Error('fetch failed')
    return 'ok'
  }, { attempts: 3, delayMs: 0 })
  assert.equal(value, 'ok')
  assert.equal(calls, 3)
})

test('retryAsync rethrows the last error after the budget', async () => {
  let calls = 0
  await assert.rejects(
    retryAsync(async () => { calls += 1; throw new Error('fetch failed') }, { attempts: 3, delayMs: 0 }),
    /fetch failed/,
  )
  assert.equal(calls, 3)
})

test('retryAsync skips retries for definitive failures', async () => {
  let calls = 0
  await assert.rejects(
    retryAsync(
      async () => { calls += 1; throw new Error('HTTP 404 https://x') },
      { attempts: 3, delayMs: 0, isRetriable: (error) => !error.message.startsWith('HTTP ') },
    ),
    /HTTP 404/,
  )
  assert.equal(calls, 1)
})
