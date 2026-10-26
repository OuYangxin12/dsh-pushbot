#!/usr/bin/env node
/** Heartbeat watchdog for the headless pushbot service (no HTTP involved). */
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const HEALTH = path.join(ROOT, 'data', 'health.json')
const CONFIG = process.env.PUSHBOT_CONFIG || path.join(ROOT, 'config.json')
const UNIT = process.env.PUSHBOT_UNIT || 'dsh-pushbot'
const log = (...a) => console.log(new Date().toISOString(), '[healthcheck]', ...a)

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

const config = await readJson(CONFIG, { topics: [] })
const everyMinutes = Math.max(30, ...((config.topics || []).map((t) => Number(t.everyMinutes || 30))))
const maxAgeMs = Number(process.env.PUSHBOT_MAX_AGE_MS || everyMinutes * 2.5 * 60000)
const maxRssMb = Number(process.env.PUSHBOT_MAX_RSS_MB || 800)

function restart(reason) {
  log('restarting', UNIT, '-', reason)
  try {
    execFileSync('systemctl', ['--user', 'restart', UNIT], { stdio: 'inherit' })
  } catch (error) {
    log('restart failed:', error.message)
    process.exitCode = 1
  }
}

const startupGraceMs = Number(process.env.PUSHBOT_STARTUP_GRACE_MS || 120000)
const health = await readJson(HEALTH, null)
if (!health) {
  restart('missing heartbeat file')
} else {
  const startedAt = Date.parse(health.startedAt || 0)
  const startedAge = Date.now() - startedAt
  if (Number.isFinite(startedAt) && startedAge < startupGraceMs && health.phase !== 'error') {
    log(`within startup grace (${Math.round(startedAge / 1000)}s), skipping`)
    process.exit(0)
  }
  const last = Date.parse(health.lastCycleAt || health.startedAt || 0)
  const age = Number.isFinite(last) ? Date.now() - last : Infinity
  if (!health.ok || health.phase === 'error') restart(`phase=${health.phase} ${health.error || ''}`)
  else if (age > maxAgeMs) restart(`heartbeat stale ${Math.round(age / 60000)}min > ${Math.round(maxAgeMs / 60000)}min`)
  else if (Number(health.rssMb || 0) > maxRssMb) restart(`rss ${health.rssMb}MB > ${maxRssMb}MB`)
  else log(`ok age=${Math.round(age / 60000)}min rss=${health.rssMb}MB deliveries=${health.deliveries}`)
}
