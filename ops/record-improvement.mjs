#!/usr/bin/env node
/** Append one improvement attempt to data/improvements.json (the gate's ledger). */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const FILE = path.join(ROOT, 'data', 'improvements.json')

const gate = JSON.parse(process.env.GATE_JSON || '{}')
const files = String(process.env.FILES || '').split(',').map((s) => s.trim()).filter(Boolean)
const record = {
  at: Date.now(),
  verdict: gate.verdict || 'unknown',
  risk: gate.risk || 'unknown',
  reasons: gate.reasons || [],
  base: gate.base || null,
  head: gate.head || null,
  files,
  deployed: process.env.DEPLOYED === '1',
  approvalId: process.env.APPROVAL_ID || null,
}

let rows = []
try { rows = JSON.parse(await readFile(FILE, 'utf8')) } catch {}
rows.push(record)
await mkdir(path.dirname(FILE), { recursive: true })
await writeFile(FILE, `${JSON.stringify(rows.slice(-200), null, 2)}\n`)
console.log(JSON.stringify(record))
