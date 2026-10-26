import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sendNotification } from '../lib/notify.js'

test('console notifier resolves', async () => {
  await sendNotification('c', { c: { kind: 'console' } }, 'hello', { root: tmpdir() })
})

test('file notifier appends under the pushbot root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pushbot-notify-'))
  await sendNotification('f', { f: { kind: 'file', path: 'data/out.log' } }, 'first', { root })
  await sendNotification('f', { f: { kind: 'file', path: 'data/out.log' } }, 'second', { root })
  const text = await readFile(path.join(root, 'data/out.log'), 'utf8')
  assert.match(text, /first/)
  assert.match(text, /second/)
})

test('unknown notifier kind rejects', async () => {
  await assert.rejects(
    sendNotification('x', { x: { kind: 'carrier-pigeon' } }, 't', { root: tmpdir() }),
    /unsupported notifier kind/,
  )
})

test('feishu-app reports the missing credential env var', async () => {
  const saved = process.env.FEISHU_APP_SECRET
  delete process.env.FEISHU_APP_SECRET
  try {
    await assert.rejects(
      sendNotification('a', { a: { kind: 'feishu-app', appId: 'cli_x', openId: 'ou_x' } }, 't', { root: tmpdir() }),
      /FEISHU_APP_SECRET/,
    )
  } finally {
    if (saved !== undefined) process.env.FEISHU_APP_SECRET = saved
  }
})
