#!/usr/bin/env node
/**
 * Human-approval queue for high-risk improvements.
 *
 *   node ops/approve.mjs request --id ID --title T --detail D [--diff FILE]
 *   node ops/approve.mjs list
 *   node ops/approve.mjs approve ID [--by NAME]
 *   node ops/approve.mjs reject ID [--by NAME] [--note TEXT]
 *   node ops/approve.mjs status ID
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const DIR = path.join(ROOT, 'data', 'approvals')
const CONFIG = path.join(ROOT, 'config.json')
const argv = process.argv.slice(2)
const command = argv[0]
const log = (...a) => console.log(...a)

function flag(name, fallback = undefined) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function save(id, value) {
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`)
}

async function all() {
  const names = (await readdir(DIR).catch(() => [])).filter((n) => n.endsWith('.json'))
  const rows = []
  for (const name of names) {
    const row = await readJson(path.join(DIR, name), null)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

async function notifyHuman(text) {
  const config = await readJson(CONFIG, null)
  const notifiers = config?.notifiers || {}
  const preferred = config?.dailyReport?.notifier
    || Object.keys(notifiers).find((key) => notifiers[key]?.url)
  const target = preferred ? notifiers[preferred] : null
  if (!target?.url) { log('(no push channel configured; request stored locally)'); return }
  try {
    const body = target.kind === 'feishu-webhook'
      ? { msg_type: 'text', content: { text } }
      : { text }
    await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    log('(approval request pushed)')
  } catch (error) {
    log(`(push failed: ${error.message}; request stored locally)`)
  }
}

if (command === 'request') {
  const id = flag('id') || `imp-${Date.now()}`
  const record = {
    id,
    title: flag('title', '未命名改动'),
    detail: flag('detail', ''),
    risk: flag('risk', 'high'),
    diff: flag('diff', null),
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  await save(id, record)
  log(`created approval request ${id}`)
  await notifyHuman(
    `[pushbot 需要你拍板] ${record.title}\n\n${record.detail}\n\n`
    + `批准：node ops/approve.mjs approve ${id}\n驳回：node ops/approve.mjs reject ${id}`,
  )
} else if (command === 'list') {
  const rows = (await all()).filter((row) => row.status === 'pending')
  if (!rows.length) { log('no pending approvals'); process.exit(0) }
  for (const row of rows) {
    log(`${row.id}  ${row.risk}  ${row.createdAt}  ${row.title}`)
    if (row.detail) log(`    ${String(row.detail).replace(/\n/g, ' ')}`)
  }
} else if (command === 'approve' || command === 'reject') {
  const id = argv[1]
  const row = await readJson(path.join(DIR, `${id}.json`), null)
  if (!row) { log(`unknown approval ${id}`); process.exit(1) }
  row.status = command === 'approve' ? 'approved' : 'rejected'
  row.decidedAt = new Date().toISOString()
  row.by = flag('by', os.userInfo().username)
  if (command === 'reject') row.note = flag('note', '')
  await save(id, row)
  log(`${id} -> ${row.status}`)
} else if (command === 'status') {
  const id = argv[1]
  const row = await readJson(path.join(DIR, `${id}.json`), null)
  log(row ? JSON.stringify(row, null, 2) : `unknown approval ${id}`)
} else {
  log('usage: approve.mjs request|list|approve|reject|status')
  process.exit(2)
}
