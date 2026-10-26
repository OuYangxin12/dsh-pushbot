#!/usr/bin/env node
/**
 * Fail CI when a relative Markdown link in README.md or docs/ points nowhere.
 * Keeps the "short README + docs/ tree" layout honest as files move.
 */
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.env.PUSHBOT_ROOT || process.cwd()
const DOCS = path.join(ROOT, 'docs')

const files = [path.join(ROOT, 'README.md')]
for (const name of (await readdir(DOCS).catch(() => [])).filter((n) => n.endsWith('.md'))) {
  files.push(path.join(DOCS, name))
}

const broken = []
let checked = 0
for (const file of files) {
  let text
  try { text = await readFile(file, 'utf8') } catch { continue }
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const clean = target.split('#')[0]
    if (!clean) continue
    checked += 1
    const resolved = path.resolve(path.dirname(file), clean)
    try { await access(resolved) } catch { broken.push(`${path.relative(ROOT, file)} -> ${target}`) }
  }
}

if (broken.length) {
  console.error(`docs: ${broken.length} broken link(s)`)
  for (const item of broken) console.error(`  ${item}`)
  process.exit(1)
}
console.log(`docs: ${checked} relative links OK`)
