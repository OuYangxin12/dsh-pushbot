#!/usr/bin/env node
/**
 * Evaluate the pending improvement against the deterministic gate.
 *
 *   node ops/gate.mjs --diff-base <gitref> [--json]
 *
 * Exit codes: 0 = pass (auto deploy), 2 = approval needed, 1 = blocked.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { evaluateGate, hasUncommitted } from './lib/gate-rules.mjs'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const jsonOut = process.argv.includes('--json')
const baseIndex = process.argv.indexOf('--diff-base')
const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : 'HEAD~1'

const log = (...a) => { if (!jsonOut) console.error(...a) }

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })
}

const head = git(['rev-parse', 'HEAD']).trim()
const status = git(['status', '--porcelain'])
const numstat = git(['diff', '--numstat', `${base}..${head}`]).trim()
const files = numstat
  ? numstat.split('\n').filter(Boolean).map((line) => {
    const [additions, deletions, filePath] = line.split('\t')
    return {
      path: filePath,
      additions: additions === '-' ? 0 : Number(additions),
      deletions: deletions === '-' ? 0 : Number(deletions),
      binary: additions === '-',
    }
  })
  : []

let addedText = ''
try {
  addedText = execFileSync(
    'git',
    ['-C', ROOT, 'diff', '--unified=0', `${base}..${head}`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .join('\n')
} catch { addedText = '' }

let ciOk = true
try {
  log('gate: running CI…')
  execFileSync('bash', [path.join(ROOT, 'ops', 'ci.sh')], { stdio: jsonOut ? 'pipe' : 'inherit' })
} catch { ciOk = false }

let freezeOk = true
try {
  execFileSync('node', [path.join(ROOT, 'ops', 'freeze.mjs'), '--verify'], { stdio: jsonOut ? 'pipe' : 'inherit' })
} catch { freezeOk = false }

let history = []
try { history = JSON.parse(await readFile(path.join(ROOT, 'data', 'improvements.json'), 'utf8')) } catch {}

const result = evaluateGate({
  files,
  addedText,
  ciOk,
  freezeOk,
  history,
  uncommitted: hasUncommitted(status),
  now: Date.now(),
})

const payload = { base, head, ciOk, freezeOk, ...result }
if (jsonOut) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  log(`gate: ${result.verdict} (${result.risk})`)
  for (const reason of result.reasons) log(`  ${reason}`)
  log(`  files=${result.stats.files} lines=${result.stats.lines}`)
}
process.exit(result.verdict === 'pass' ? 0 : result.verdict === 'approval' ? 2 : 1)
