#!/usr/bin/env node
/**
 * Idempotent supervisor for the headless pushbot (cron / non-systemd fallback).
 *
 * Starts the service when it is missing, and also replaces a process whose
 * heartbeat is stale — a broken plugin can leave DSH alive with no working
 * watcher, so "process exists" is not enough.
 */
import { readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const NODE = process.execPath
const BIN = process.env.PUSHBOT_DSH_BIN
const PATTERN = '^[^ ]*node .*lib/bin\\.js --profile pushbot$'
const log = (...a) => console.log(new Date().toISOString(), '[ensure]', ...a)

function pids() {
  try {
    return execFileSync('pgrep', ['-f', PATTERN], { encoding: 'utf8' })
      .split('\n').map((s) => Number(s.trim())).filter(Boolean)
  } catch { return [] }
}

function config() {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'config.json'), 'utf8')) } catch { return { topics: [] } }
}

function maxAgeMs() {
  const every = Math.max(30, ...((config().topics || []).map((t) => Number(t.everyMinutes || 30))))
  return Number(process.env.PUSHBOT_MAX_AGE_MS || every * 2.5 * 60000)
}

function heartbeatFresh() {
  try {
    const health = JSON.parse(readFileSync(path.join(ROOT, 'data', 'health.json'), 'utf8'))
    if (!health.ok || health.phase === 'error') return false
    const last = Date.parse(health.lastCycleAt || health.startedAt || 0)
    return Date.now() - last < maxAgeMs()
  } catch { return false }
}

const running = pids()
if (running.length && heartbeatFresh()) {
  log('healthy, nothing to do', running.join(','))
  process.exit(0)
}
if (running.length) {
  log('stale or unhealthy; restarting pids', running.join(','))
  for (const pid of running) { try { process.kill(pid, 'SIGTERM') } catch {} }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && pids().length) {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200) } catch {}
  }
  for (const pid of pids()) { try { process.kill(pid, 'SIGKILL') } catch {} }
}

if (!BIN) {
  log('PUSHBOT_DSH_BIN is not set; cannot start the service')
  process.exit(1)
}
const child = spawn(NODE, [BIN, '--profile', 'pushbot'], {
  detached: true,
  stdio: ['ignore', 'ignore', 'ignore'],
  env: { ...process.env, DSH_HOME: path.join(ROOT, 'home'), PUSHBOT_ROOT: ROOT, PUSHBOT_CONFIG: path.join(ROOT, 'config.json') },
})
child.unref()
log('started pid', child.pid)
