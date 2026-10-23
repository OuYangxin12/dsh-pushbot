import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LIMITS, evaluateGate, hasUncommitted } from '../lib/gate-rules.mjs'

const codeFile = (path, additions = 10, deletions = 2) => ({ path, additions, deletions })
const base = (over = {}) => ({
  files: [codeFile('app/packages/dsh-pushbot-app/lib/core.js')],
  ciOk: true,
  freezeOk: true,
  history: [],
  now: 1_700_000_000_000,
  ...over,
})

test('clean code-only change passes and is low risk', () => {
  const result = evaluateGate(base())
  assert.equal(result.verdict, 'pass')
  assert.equal(result.risk, 'low')
  assert.deepEqual(result.stats, { files: 1, additions: 10, deletions: 2, lines: 12 })
})

test('CI failure blocks', () => {
  assert.equal(evaluateGate(base({ ciOk: false })).verdict, 'blocked')
})

test('modified bootstrap blocks', () => {
  const result = evaluateGate(base({ freezeOk: false }))
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.includes('blocked:bootstrap-modified'))
})

test('uncommitted work blocks the gate', () => {
  assert.equal(evaluateGate(base({ uncommitted: true })).verdict, 'blocked')
})

test('out-of-scope file blocks', () => {
  const result = evaluateGate(base({ files: [codeFile('ops/promote.mjs')] }))
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.some((r) => r.startsWith('blocked:out-of-scope')))
})

test('too many files blocks', () => {
  const files = Array.from({ length: DEFAULT_LIMITS.maxFiles + 1 }, (_, i) =>
    codeFile(`app/packages/dsh-pushbot-app/lib/f${i}.js`))
  const result = evaluateGate(base({ files }))
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.some((r) => r.startsWith('blocked:too-many-files')))
})

test('oversized diff blocks', () => {
  const result = evaluateGate(base({ files: [codeFile('app/packages/dsh-pushbot-app/lib/a.js', 401, 0)] }))
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.some((r) => r.startsWith('blocked:diff-too-large')))
})

test('secrets in the diff block', () => {
  for (const text of [
    'const key = "sk-abcdefghijklmnopqrstuvwx"',
    'botId: "bot_0123456789abcdef"',
    'https://open.feishu.cn/open-apis/bot/v2/hook/abcd-1234-efgh',
  ]) {
    const result = evaluateGate(base({ addedText: text }))
    assert.equal(result.verdict, 'blocked', text)
    assert.ok(result.reasons.some((r) => r.startsWith('blocked:secret.')))
  }
})

test('daily quota blocks a second automatic deploy', () => {
  const result = evaluateGate(base({
    history: [{ at: 1_700_000_000_000 - 3600_000, files: ['x'], deployed: true }],
  }))
  assert.equal(result.verdict, 'blocked')
  assert.ok(result.reasons.some((r) => r.startsWith('blocked:daily-quota')))
})

test('a deploy older than a day does not consume the quota', () => {
  const result = evaluateGate(base({
    history: [{ at: 1_700_000_000_000 - 2 * 86400_000, files: ['x'], deployed: true }],
  }))
  assert.equal(result.verdict, 'pass')
})

test('touching docs requires human approval', () => {
  const result = evaluateGate(base({
    files: [codeFile('app/packages/dsh-pushbot-app/lib/core.js'), codeFile('README.md', 5, 1)],
  }))
  assert.equal(result.verdict, 'approval')
  assert.ok(result.reasons.some((r) => r.startsWith('approval:docs-touched')))
})

test('repeated edits to the same file require approval', () => {
  const file = 'app/packages/dsh-pushbot-app/lib/core.js'
  const result = evaluateGate(base({
    history: [
      { at: 1_700_000_000_000 - 86400_000, files: [file], deployed: true },
      { at: 1_700_000_000_000 - 2 * 86400_000, files: [file], deployed: true },
    ],
  }))
  assert.equal(result.verdict, 'approval')
  assert.ok(result.reasons.some((r) => r.startsWith('approval:churn')))
})

test('old churn outside the window does not require approval', () => {
  const file = 'app/packages/dsh-pushbot-app/lib/core.js'
  const result = evaluateGate(base({
    history: [
      { at: 1_700_000_000_000 - 30 * 86400_000, files: [file], deployed: true },
      { at: 1_700_000_000_000 - 40 * 86400_000, files: [file], deployed: true },
    ],
  }))
  assert.equal(result.verdict, 'pass')
})

test('empty diff passes the rules (caller handles no-op)', () => {
  const result = evaluateGate(base({ files: [] }))
  assert.equal(result.verdict, 'pass')
})

test('hasUncommitted ignores runtime state but catches source edits', () => {
  assert.equal(hasUncommitted(''), false)
  assert.equal(hasUncommitted('?? data/state.json\n?? versions/v005/\n'), false)
  assert.equal(hasUncommitted(' M app/packages/dsh-pushbot-app/lib/core.js'), true)
})
