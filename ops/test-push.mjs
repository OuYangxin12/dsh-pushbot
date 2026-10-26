#!/usr/bin/env node
/**
 * Send one test message through the configured channel.
 *
 *   node ops/test-push.mjs [--notifier <id>]
 *
 * Reads config.json, loads home/feishu.env for credentials, and reuses the
 * same notifier implementation as the service, so a green result here means the
 * real delivery path works.
 */
import { readFile, mkdir, appendFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { sendNotification } from '../app/packages/dsh-pushbot-app/lib/notify.js'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const CONFIG = process.env.PUSHBOT_CONFIG || path.join(ROOT, 'config.json')
const argv = process.argv.slice(2)
const wanted = argv.includes('--notifier') ? argv[argv.indexOf('--notifier') + 1] : undefined

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function loadEnv(file) {
  let text
  try { text = await readFile(file, 'utf8') } catch { return }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index < 0) continue
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim()
    if (key && !(key in process.env)) process.env[key] = value
  }
}

await loadEnv(path.join(ROOT, 'home', 'feishu.env'))

const config = await readJson(CONFIG, null)
if (!config) {
  console.error(`读不到配置：${CONFIG}`)
  process.exit(1)
}
const notifiers = config.notifiers || {}
// Prefer a channel the topics actually use, then any non-debug channel.
const used = (config.topics || []).map((topic) => topic.notifier).filter(Boolean)
const byUsage = used.find((id) => notifiers[id] && !['file', 'console'].includes(notifiers[id].kind))
const candidates = Object.entries(notifiers).filter(([, row]) => !['file', 'console'].includes(row.kind))
const notifierId = wanted || byUsage || candidates[0]?.[0] || Object.keys(notifiers)[0]
if (!notifierId) {
  console.error('配置里没有任何通知器')
  process.exit(1)
}

const text = [
  '**dsh-pushbot 测试推送**',
  '来自控制面板的测试消息，收到说明这个通道可用。',
  `时间：${new Date().toLocaleString()}`,
].join('\n')

try {
  await sendNotification(notifierId, notifiers, text, { root: ROOT })
  console.log(`✓ 已通过「${notifierId}」发送测试消息`)
} catch (error) {
  console.error(`✗ 发送失败（${notifierId}）：${error.message}`)
  process.exit(1)
}
