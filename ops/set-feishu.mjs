#!/usr/bin/env node
/**
 * One-command Feishu setup.
 *
 *   node ops/set-feishu.mjs <webhook-url> [--secret <signing-secret>]
 *                                      [--keep-notifiers] [--test-only] [--force]
 *
 * Sends a test message first; only writes config.json when the bot accepted it
 * (unless --force). Topics still pointing at the `file` notifier are switched to
 * `feishu` unless --keep-notifiers is given.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { buildFeishuBody } from '../app/packages/dsh-pushbot-app/lib/core.js'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const argv = process.argv.slice(2)
const url = argv.find((arg) => !arg.startsWith('--') && arg.startsWith('http'))
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = undefined) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const configPath = value('config', path.join(ROOT, 'config.json'))
const secret = value('secret', undefined)
const keepNotifiers = flag('keep-notifiers')
const testOnly = flag('test-only')
const force = flag('force')

if (!url) {
  console.error('用法: node ops/set-feishu.mjs <webhook-url> [--secret <签名密钥>] [--keep-notifiers] [--test-only] [--force]')
  process.exit(2)
}
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)
const looksFeishu = url.startsWith('https://open.feishu.cn/open-apis/bot/v2/hook/')
if (!looksFeishu && !isLocal) {
  console.error('这不像飞书机器人地址。正确格式：https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx')
  process.exit(2)
}

const TEST_TEXT = 'dsh-pushbot 已接入飞书 ✅\n这是一条测试消息，收到它说明 webhook 可用。'

async function sendTest() {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildFeishuBody(TEST_TEXT, secret)),
    signal: AbortSignal.timeout(10000),
  })
  const raw = await response.text()
  let payload = {}
  try { payload = JSON.parse(raw) } catch {}
  const code = payload.code ?? payload.StatusCode ?? 0
  const ok = response.ok && (code === 0 || code === undefined)
  return { ok, status: response.status, code, msg: payload.msg || raw.slice(0, 200) }
}

let result
try {
  result = await sendTest()
} catch (error) {
  console.error(`✗ 连接失败：${error.message}`)
  console.error('  检查：webhook 是否复制完整、本机能否访问 open.feishu.cn')
  process.exit(1)
}

if (!result.ok) {
  console.error(`✗ 飞书拒绝了这条消息（HTTP ${result.status}, code=${result.code}）：${result.msg}`)
  if (result.code === 19021 || /sign/i.test(String(result.msg))) {
    console.error('  这是签名校验失败：把机器人的「签名校验」密钥填进来，加 --secret <密钥> 重试')
  } else if (/keyword|关键词/i.test(String(result.msg))) {
    console.error('  这是关键词校验失败：机器人安全设置里加自定义关键词「新内容」后重试')
  } else if (result.code === 19001 || /param/i.test(String(result.msg))) {
    console.error('  地址可能不完整，请重新复制整条 webhook 地址')
  }
  if (!force) {
    console.error('  （未写入配置。确认地址/密钥后重试，或加 --force 强制写入）')
    process.exit(1)
  }
  console.error('  --force：仍然写入配置')
}

if (testOnly) {
  console.log('✓ 测试消息已发送（未修改配置）')
  process.exit(0)
}

let config
try {
  config = JSON.parse(await readFile(configPath, 'utf8'))
} catch {
  console.error(`✗ 读不到配置：${configPath}`)
  process.exit(1)
}

config.notifiers ??= {}
config.notifiers.feishu = { kind: 'feishu-webhook', url, ...(secret ? { secret } : {}) }
const switched = []
if (!keepNotifiers) {
  for (const topic of config.topics || []) {
    if (topic.notifier === 'file') { topic.notifier = 'feishu'; switched.push(topic.id) }
  }
}
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

console.log('✓ 已写入配置：' + configPath)
console.log(`  飞书 webhook：${url.slice(0, 48)}…${secret ? '（含签名密钥）' : '（无签名）'}`)
if (switched.length) console.log(`  这些主题已切到飞书：${switched.join(', ')}`)
console.log('')
console.log('下一步：')
console.log('  1) 跑一轮确认能收到真实推送：bash ops/run-once.sh')
console.log('  2) 装成常驻服务（普通终端）：bash ops/install-service.sh')
