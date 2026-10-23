#!/usr/bin/env node
/**
 * Local CD for dsh-pushbot.
 *   node ops/promote.mjs              # deploy the newest build
 *   node ops/promote.mjs v003         # deploy a specific build
 *   node ops/promote.mjs rollback     # deploy the build before current
 *
 * Steps: verify checksums -> atomic `versions/current` swap -> restart ->
 * wait for a fresh heartbeat -> roll back automatically on failure.
 */
import { mkdir, readFile, readdir, readlink, rename, symlink, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const VERSIONS = path.join(ROOT, 'versions')
const CURRENT = path.join(VERSIONS, 'current')
const HEALTH = path.join(ROOT, 'data', 'health.json')
const DEPLOYS = path.join(ROOT, 'data', 'deploys.json')
const UNIT = process.env.PUSHBOT_UNIT || 'dsh-pushbot'
const arg = process.argv[2]
const log = (...a) => console.log(new Date().toISOString(), '[promote]', ...a)

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}
const readChecksum = async (file) => createHash('sha256').update(await readFile(file)).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function listBuilds() {
  const names = (await readdir(VERSIONS, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && /^v\d{3}$/.test(e.name))
    .map((e) => e.name)
  return names.sort()
}

async function currentBuild() {
  try {
    const target = await readlink(CURRENT)
    return path.basename(target)
  } catch { return null }
}

async function verify(build) {
  const dir = path.join(VERSIONS, build)
  const manifest = await readJson(path.join(dir, 'manifest.json'), null)
  if (!manifest) throw new Error(`missing manifest for ${build}`)
  for (const [rel, expected] of Object.entries(manifest.files || {})) {
    const actual = await readChecksum(path.join(dir, 'packages/dsh-pushbot-app', rel))
    if (actual !== expected) throw new Error(`checksum mismatch ${build}/${rel}`)
  }
  return manifest
}

async function swap(build) {
  const target = build.startsWith('v') ? build : 'v' + build
  const tmp = path.join(VERSIONS, `.current.tmp-${process.pid}`)
  await symlink(target, tmp)
  await rename(tmp, CURRENT)
  log('current ->', build)
}

function runningPids() {
  try {
    return execFileSync("pgrep", ["-f", "^[^ ]*node .*lib/bin\\.js --profile pushbot$"], { encoding: "utf8" })
      .split("\n").map((s) => Number(s.trim())).filter(Boolean)
  } catch { return [] }
}

async function stopAll() {
  const pids = runningPids()
  if (!pids.length) return
  log("stopping pids", pids.join(","))
  for (const pid of pids) { try { process.kill(pid, "SIGTERM") } catch {} }
  for (let i = 0; i < 50 && runningPids().length; i += 1) await sleep(200)
  for (const pid of runningPids()) { try { process.kill(pid, "SIGKILL") } catch {} }
}

async function restart() {
  try {
    execFileSync("systemctl", ["--user", "restart", UNIT], { stdio: "pipe" })
    log("restarted via systemd")
    return "systemd"
  } catch {
    await stopAll()
    try {
      execFileSync("bash", [path.join(ROOT, "ops", "ensure.sh")], { stdio: "inherit" })
      log("restarted via ensure.sh")
      return "ensure.sh"
    } catch (error) {
      log("supervisor failed:", error.message)
      return "ensure.sh-failed"
    }
  }
}

async function waitHealthy(sinceIso, timeoutMs = Number(process.env.PUSHBOT_HEALTH_TIMEOUT_MS || 60000)) {
  const since = Date.parse(sinceIso)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await readJson(HEALTH, null)
    const started = Date.parse(health?.startedAt || 0)
    const settled = health?.phase === 'ok' || health?.phase === 'idle'
    if (health?.ok && settled && started >= since) return health
    await sleep(1000)
  }
  return null
}

async function record(entry) {
  const history = await readJson(DEPLOYS, [])
  history.push({ at: new Date().toISOString(), ...entry })
  await mkdir(path.dirname(DEPLOYS), { recursive: true })
  await writeFile(DEPLOYS, JSON.stringify(history.slice(-100), null, 2) + '\n')
}

const builds = await listBuilds()
if (!builds.length) { log('no builds yet; run ops/build.sh'); process.exit(1) }

const current = await currentBuild()
let target
if (arg === 'rollback') {
  if (!current) { log('nothing deployed; nothing to roll back'); process.exit(1) }
  const index = builds.indexOf(current)
  if (index <= 0) { log('no previous build to roll back to'); process.exit(1) }
  target = builds[index - 1]
} else if (arg) {
  target = arg.startsWith('v') ? arg : `v${arg.padStart(3, '0')}`
} else {
  target = builds[builds.length - 1]
}
if (!builds.includes(target)) { log('unknown build', target, 'available:', builds.join(' ')); process.exit(1) }

const manifest = await verify(target)
log(`deploying ${target} (version ${manifest.version}, git ${manifest.gitSha || 'n/a'})`)
const mark = new Date().toISOString()
await swap(target)
const mode = await restart()
const health = await waitHealthy(mark)
if (!health) {
  log('health check FAILED; rolling back')
  if (current && current !== target) {
    await swap(current)
    await restart().catch((error) => log("rollback restart failed:", error.message))
    await record({ action: 'rollback-after-failure', failed: target, restored: current, manifest })
  }
  await record({ action: 'deploy-failed', target, manifest })
  process.exit(1)
}
await record({ action: 'deploy', target, previous: current, manifest, mode })
log(`deployed ${target}; health ok pid=${health.pid} version=${health.version}`)
