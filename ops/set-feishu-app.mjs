#!/usr/bin/env node
/**
 * Zero-click Feishu setup: reuse the 智能体 you already linked to DSH.
 *
 *   node ops/set-feishu-app.mjs [--bot <botId>] [--format markdown|plain]
 *                               [--no-switch] [--test-only]
 *
 * Reads appId / owner open id from every integration directory under ~/.dsh, and the app
 * secret from ~/.dsh/.credentials.yaml, sends a test message through the Feishu
 * Open API, then writes home/feishu.env (0600) + config.json.
 */
import { chmod, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { buildFeishuAppPayload } from '../app/packages/dsh-pushbot-app/lib/core.js'

const ROOT = process.env.PUSHBOT_ROOT || path.join(os.homedir(), 'pushbot')
const DSH_HOME = process.env.PUSHBOT_DSH_HOME || path.join(os.homedir(), '.dsh')
const API = 'https://open.feishu.cn/open-apis'
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback = undefined) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const format = value('format', 'markdown')
const onlyBot = value('bot')
const testOnly = flag('test-only')
const keepNotifiers = flag('no-switch')
const configPath = value('config', path.join(ROOT, 'config.json'))
const envPath = path.join(ROOT, 'home', 'feishu.env')

async function discover() {
  const dir = path.join(DSH_HOME, 'integrations')
  const found = []
  for (const name of await readdir(dir).catch(() => [])) {
    let cfg
    try { cfg = JSON.parse(await readFile(path.join(dir, name, 'config.json'), 'utf8')) } catch { continue }
    for (const bot of cfg.bots || []) {
      if (bot?.id && bot?.appId && bot?.ownerOpenIds?.length) {
        found.push({ channel: name, botId: bot.id, appId: bot.appId, name: bot.botName || bot.appId,
                     openId: bot.ownerOpenIds[0], secretRef: bot.secretRef })
      }
    }
  }
  return found
}

function credentialRefs(yaml) {
  const refs = {}
  let inRefs = false
  for (const line of yaml.split('\n')) {
    if (/^refs:\s*$/.test(line)) { inRefs = true; continue }
    if (inRefs && /^\S/.test(line)) break
    const match = inRefs && line.match(/^\s+([A-Za-z0-9_]+):\s*(.+)$/)
    if (match) refs[match[1]] = match[2].trim()
  }
  return refs
}

const bots = await discover()
if (!bots.length) {
  console.error('没有在 ~/.dsh/integrations 找到已接入且带 owner 的飞书机器人。')
  console.error('请先在 DSH「设置 → IM机器人」里接入飞书智能体。')
  process.exit(1)
}
const bot = onlyBot ? bots.find((row) => row.botId === onlyBot) : bots.find((row) => /feishu|lark/i.test(row.channel)) || bots[0]
if (!bot) { console.error(`找不到 botId=${onlyBot}`); process.exit(1) }

const refs = credentialRefs(await readFile(path.join(DSH_HOME, '.credentials.yaml'), 'utf8').catch(() => ''))
const secret = refs[bot.secretRef] || process.env.FEISHU_APP_SECRET
if (!secret) {
  console.error(`找不到飞书应用密钥（凭据名 ${bot.secretRef}）。`)
  console.error('可在 ~/.dsh/.credentials.yaml 里补上，或用 FEISHU_APP_SECRET 环境变量提供。')
  process.exit(1)
}

const TEST_TEXT = '**dsh-pushbot 已接入**\n\n这是一条测试消息，收到它说明这个飞书智能体的推送通道可用。'

async function post(pathname, body, token) {
  const response = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

const tokenResult = await post('/auth/v3/tenant_access_token/internal', { app_id: bot.appId, app_secret: secret })
if (tokenResult.json.code !== 0 || !tokenResult.json.tenant_access_token) {
  console.error(`✗ 获取 token 失败（code=${tokenResult.json.code}）：${tokenResult.json.msg || ''}`)
  console.error('  检查应用凭据是否被重置，或应用是否开通了 im:message:send_as_bot 权限。')
  process.exit(1)
}
const token = tokenResult.json.tenant_access_token
const payload = buildFeishuAppPayload(TEST_TEXT, format)
const sent = await post('/im/v1/messages?receive_id_type=open_id', { receive_id: bot.openId, ...payload }, token)
if (sent.json.code !== 0) {
  console.error(`✗ 发送失败（code=${sent.json.code}）：${sent.json.msg || ''}`)
  process.exit(1)
}
console.log(`✓ 测试消息已发送到「${bot.name}」`)

if (testOnly) process.exit(0)

await mkdir(path.join(ROOT, 'home'), { recursive: true })
await writeFile(envPath, `# Feishu app credential for dsh-pushbot (0600, never committed)\nFEISHU_APP_ID=${bot.appId}\nFEISHU_APP_SECRET=${secret}\n`)
await chmod(envPath, 0o600)

const config = JSON.parse(await readFile(configPath, 'utf8'))
config.notifiers ??= {}
config.notifiers['feishu-app'] = {
  kind: 'feishu-app',
  appId: bot.appId,
  appSecretEnv: 'FEISHU_APP_SECRET',
  openId: bot.openId,
  format,
}
const switched = []
if (!keepNotifiers) {
  for (const topic of config.topics || []) {
    if (topic.notifier === 'file' || topic.notifier === 'feishu') {
      topic.notifier = 'feishu-app'
      switched.push(topic.id)
    }
  }
}
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

console.log(`✓ 已写入 ${envPath}（0600）和 ${configPath}`)
console.log(`  通道：飞书应用直连（${bot.name}）→ openId=${bot.openId.slice(0, 6)}…，格式=${format}`)
if (switched.length) console.log(`  这些主题已切过来：${switched.join(', ')}`)
console.log('')
console.log('下一步：bash ops/run-once.sh   （服务已在跑的话也可以等下一轮自动推送）')
