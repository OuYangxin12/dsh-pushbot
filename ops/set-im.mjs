#!/usr/bin/env node
/**
 * Point dsh-pushbot at the IM bot already connected to your main DSH host
 * (e.g. the Feishu 智能体 you can chat with), instead of a group webhook.
 *
 *   node ops/set-im.mjs --target <targetId> [--bot <botId>] [--base-url URL]
 *                       [--format markdown|plain] [--keep-notifiers] [--test-only] [--force]
 *
 * The botId is discovered from the main DSH installation, so you only need the
 * delivery target id printed by 设置 → IM机器人 → 复制调用参数.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { buildDshImBody } from '../app/packages/dsh-pushbot-app/lib/core.js'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const DSH_HOME = process.env.PUSHBOT_DSH_HOME || path.join(os.homedir(), '.dsh')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = undefined) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const targetId = value('target')
const explicitBot = value('bot')
const format = value('format', 'markdown')
const baseUrl = String(
  value('base-url') || process.env.DSH_WEB_URL || 'http://127.0.0.1:3081',
).replace(/\/$/, '')
const configPath = value('config', path.join(ROOT, 'config.json'))
const testOnly = flag('test-only')
const keepNotifiers = flag('keep-notifiers')
const force = flag('force')

if (!targetId) {
  console.error('用法: node ops/set-im.mjs --target <targetId> [--format markdown|plain]')
  console.error('targetId 在 DSH「设置 → IM机器人」里点机器人卡片齿轮 → 新建目标 → 保存 → 复制调用参数')
  process.exit(2)
}

/** Discover bots from every IM integration directory under the main DSH home. */
async function discoverBots() {
  const integrations = path.join(DSH_HOME, 'integrations')
  const dirs = (await readdir(integrations).catch(() => []))
  const bots = []
  for (const dir of dirs) {
    let config
    try { config = JSON.parse(await readFile(path.join(integrations, dir, 'config.json'), 'utf8')) } catch { continue }
    for (const bot of config.bots || []) {
      if (bot?.id) bots.push({ botId: bot.id, channel: dir, name: bot.botName || bot.appId || '(未命名)' })
    }
  }
  return bots
}

const bots = await discoverBots()
if (!bots.length) {
  console.error('没有在 ~/.dsh/integrations 下找到已接入的 IM 机器人。')
  console.error('请先在 DSH「设置 → IM机器人」里接入飞书/微信，再回来运行本命令。')
  process.exit(1)
}
let bot
if (explicitBot) {
  bot = bots.find((row) => row.botId === explicitBot)
  if (!bot) { console.error(`找不到 botId=${explicitBot}`); process.exit(1) }
} else if (bots.length === 1) {
  bot = bots[0]
} else {
  bot = bots.find((row) => /feishu|lark/i.test(row.channel)) || bots[0]
  console.error(`发现多个机器人，默认使用 ${bot.name}（${bot.channel}）；可用 --bot 指定`)
}

const TEST_TEXT = '**dsh-pushbot 已接入**\n这是一条测试消息，收到它说明投递链路可用。'

async function sendTest() {
  const response = await fetch(`${baseUrl}/api/dsh-im/delivery/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildDshImBody(bot.botId, targetId, TEST_TEXT, format)),
    signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, ok: payload.sent === true, code: payload?.error?.code, msg: payload?.error?.message }
}

let result
try {
  result = await sendTest()
} catch (error) {
  console.error(`✗ 连不上 DSH Host（${baseUrl}）：${error.message}`)
  console.error('  主 DSH 需要处于运行状态，因为 IM 机器人的连接在它里面。')
  process.exit(1)
}

if (!result.ok) {
  const hints = {
    'unknown-target': () => {
      console.error('✗ 这个 targetId 不存在。')
      console.error('  去 DSH「设置 → IM机器人」→ 机器人卡片齿轮 → 新建目标 → 选你和机器人的私聊 →')
      console.error('  把 Target ID 改成好记的（如 feishu-me）→ 测试 → 保存 → 复制调用参数。')
    },
    'unknown-bot': () => console.error('✗ 机器人 ID 对不上，可能机器人被移除后重新接入了。'),
    'bot-not-connected': () => console.error('✗ 机器人当前离线，先在 DSH 里确认它已连接。'),
    'invalid-target': () => console.error('✗ 目标类型或平台 ID 无效，重新建一个目标。'),
  }
  ;(hints[result.code] || (() => console.error(`✗ 发送失败（HTTP ${result.status}, ${result.code || 'unknown'}）${result.msg || ''}`)))()
  if (!force) {
    console.error('  （未写入配置；如确定要写入加 --force）')
    process.exit(1)
  }
  console.error('  --force：仍然写入配置')
} else {
  console.log(`✓ 测试消息已发送到「${bot.name}」`)
}

if (testOnly) process.exit(0)

let config
try { config = JSON.parse(await readFile(configPath, 'utf8')) } catch {
  console.error(`✗ 读不到配置：${configPath}`)
  process.exit(1)
}

config.notifiers ??= {}
config.notifiers['feishu-agent'] = {
  kind: 'dsh-im',
  baseUrl,
  botId: bot.botId,
  targetId,
  format,
}
const switched = []
if (!keepNotifiers) {
  for (const topic of config.topics || []) {
    if (topic.notifier === 'file' || topic.notifier === 'feishu') {
      topic.notifier = 'feishu-agent'
      switched.push(topic.id)
    }
  }
}
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

console.log(`✓ 已写入配置：${configPath}`)
console.log(`  通道：dsh-im（${bot.name}，${bot.channel}）→ target=${targetId}，格式=${format}`)
if (switched.length) console.log(`  这些主题已切过来：${switched.join(', ')}`)
console.log('')
console.log('下一步：bash ops/run-once.sh    # 跑一轮真实抓取')
console.log('常驻：  bash ops/install-service.sh')
