/**
 * Deterministic gate rules for the self-improvement loop.
 *
 * Everything here is pure: the caller gathers a diff, CI status and history,
 * this module decides whether the change may ship automatically, needs a human,
 * or is rejected outright. No LLM opinion is involved.
 */

export const DEFAULT_LIMITS = {
  maxFiles: 3,
  maxLines: 400,
  maxPerDay: 1,
  churnDays: 7,
  maxChurnPerFile: 2,
}

export const DEFAULT_SCOPES = {
  code: ['app/packages/'],
  docs: ['README.md', 'config.example.json'],
}

export const SECRET_PATTERNS = [
  { code: 'secret.openai', re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { code: 'secret.deepseek', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { code: 'secret.bot-id', re: /\bbot_[0-9a-f]{16,}/ },
  { code: 'secret.feishu-hook', re: /open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,}/ },
  { code: 'secret.bearer', re: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{12,}/i },
  { code: 'secret.slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { code: 'secret.private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
]

const DAY_MS = 86400000

function inScope(filePath, prefixes) {
  return prefixes.some((prefix) => filePath === prefix || filePath.startsWith(prefix))
}

/**
 * @param {object} input
 * @param {{path: string, additions: number, deletions: number}[]} input.files
 * @param {string} [input.addedText] added lines of the diff, for the secret scan
 * @param {boolean} input.ciOk
 * @param {boolean} input.freezeOk
 * @param {{at: number, files: string[], deployed: boolean}[]} [input.history]
 * @param {number} [input.now]
 * @param {object} [input.limits]
 * @param {object} [input.scopes]
 */
export function evaluateGate(input) {
  const limits = { ...DEFAULT_LIMITS, ...(input.limits || {}) }
  const scopes = { ...DEFAULT_SCOPES, ...(input.scopes || {}) }
  const files = input.files || []
  const history = input.history || []
  const now = Number(input.now ?? Date.now())
  const reasons = []

  const additions = files.reduce((sum, f) => sum + Number(f.additions || 0), 0)
  const deletions = files.reduce((sum, f) => sum + Number(f.deletions || 0), 0)
  const stats = { files: files.length, additions, deletions, lines: additions + deletions }

  // hard blocks
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(String(input.addedText || ''))) reasons.push(`blocked:${pattern.code}`)
  }
  const outside = files.filter((f) => !inScope(f.path, scopes.code) && !inScope(f.path, scopes.docs))
  for (const file of outside) reasons.push(`blocked:out-of-scope:${file.path}`)
  if (files.length > limits.maxFiles) reasons.push(`blocked:too-many-files:${files.length}>${limits.maxFiles}`)
  if (stats.lines > limits.maxLines) reasons.push(`blocked:diff-too-large:${stats.lines}>${limits.maxLines}`)
  if (!input.ciOk) reasons.push('blocked:ci-failed')
  if (!input.freezeOk) reasons.push('blocked:bootstrap-modified')
  if (input.uncommitted) reasons.push('blocked:uncommitted-changes')

  const deployedToday = history.filter(
    (entry) => entry.deployed && now - Number(entry.at || 0) < DAY_MS,
  )
  if (deployedToday.length >= limits.maxPerDay) reasons.push(`blocked:daily-quota:${deployedToday.length}`)

  const blocked = reasons.some((reason) => reason.startsWith('blocked:'))
  if (blocked) return { verdict: 'blocked', risk: 'high', reasons, stats }

  // human approval required
  const docFiles = files.filter((f) => inScope(f.path, scopes.docs) && !inScope(f.path, scopes.code))
  if (docFiles.length) reasons.push(`approval:docs-touched:${docFiles.map((f) => f.path).join(',')}`)

  const recentWindow = now - limits.churnDays * DAY_MS
  const recent = history.filter((entry) => Number(entry.at || 0) > recentWindow)
  for (const file of files) {
    const touched = recent.filter((entry) => (entry.files || []).includes(file.path)).length
    if (touched >= limits.maxChurnPerFile) {
      reasons.push(`approval:churn:${file.path}:${touched}`)
    }
  }

  if (reasons.length) return { verdict: 'approval', risk: 'high', reasons, stats }
  return { verdict: 'pass', risk: 'low', reasons: ['ok:code-only'], stats }
}

/** True when the working tree has uncommitted changes the gate must reject. */
export function hasUncommitted(statusOutput) {
  return String(statusOutput || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // build outputs and local state never count as work
    .filter((line) => !/^\?\?\s+(data|versions|home)\//.test(line))
    .length > 0
}
