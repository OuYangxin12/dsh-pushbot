#!/usr/bin/env node
/**
 * Bootstrap freeze: the self-improver must not be able to edit its own brakes
 * (gates, supervisor, promote/rollback, units, prompt, tests).
 *
 *   node ops/freeze.mjs            # verify (exit 1 on drift)
 *   node ops/freeze.mjs --verify   # same
 *   node ops/freeze.mjs --generate # rewrite ops/CHECKSUMS
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const OPS = path.join(ROOT, 'ops')
const SUMS = path.join(OPS, 'CHECKSUMS')

async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await walk(path.join(dir, entry.name), rel))
    else if (entry.name !== 'CHECKSUMS') files.push(rel)
  }
  return files.sort()
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const files = await walk(OPS)
const lines = []
for (const rel of files) {
  lines.push(`${sha256(await readFile(path.join(OPS, rel)))}  ${rel}`)
}
const rendered = `${lines.join('\n')}\n`

const mode = process.argv.includes('--generate') ? 'generate' : 'verify'
if (mode === 'generate') {
  await writeFile(SUMS, rendered)
  console.log(`froze ${files.length} files into ops/CHECKSUMS`)
} else {
  let recorded
  try { recorded = await readFile(SUMS, 'utf8') } catch {
    console.error('freeze: ops/CHECKSUMS missing; run --generate')
    process.exit(1)
  }
  const expected = new Map(
    recorded.trim().split('\n').filter(Boolean).map((line) => {
      const [hash, ...rest] = line.split(/\s+/)
      return [rest.join(' '), hash]
    }),
  )
  const drift = []
  for (const [rel, hash] of expected) {
    try {
      if (sha256(await readFile(path.join(OPS, rel))) !== hash) drift.push(`modified: ${rel}`)
    } catch { drift.push(`missing: ${rel}`) }
  }
  const current = new Set(files)
  for (const rel of expected.keys()) if (!current.has(rel)) drift.push(`missing: ${rel}`)
  for (const rel of current) if (!expected.has(rel)) drift.push(`added: ${rel}`)
  if (drift.length) {
    console.error('freeze: bootstrap drift detected')
    for (const item of drift) console.error(`  ${item}`)
    process.exit(1)
  }
  console.log(`freeze: ${expected.size} bootstrap files intact`)
}
