/**
 * Every delivery channel lives here so the service, the CLI test command and
 * the control panel share one implementation.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { buildDshImBody, buildFeishuAppPayload, buildFeishuBody, tokenFresh } from './core.js'
import { request } from './http.js'

const FEISHU_API = 'https://open.feishu.cn/open-apis'
let feishuToken = { value: null, expiresAt: 0 }

const log = (...args) => console.log(new Date().toISOString(), '[pushbot]', ...args)

/** Resolve a config-relative path against the pushbot root. */
function localPath(root, value) {
  return path.isAbsolute(value) ? value : path.join(root, value)
}

export async function feishuAppToken(notifier, { forceRefresh = false } = {}) {
  if (!forceRefresh && feishuToken.value && tokenFresh(feishuToken.expiresAt)) return feishuToken.value
  const envName = notifier.appSecretEnv || 'FEISHU_APP_SECRET'
  const secret = process.env[envName]
  if (!secret) throw new Error(`feishu-app: 缺少凭据环境变量 ${envName}`)
  const response = await request(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: notifier.appId, app_secret: secret }),
  })
  const payload = await response.json().catch(() => ({}))
  if (payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(`feishu-app token ${payload.code ?? '?'} ${payload.msg || ''}`.trim())
  }
  feishuToken = {
    value: payload.tenant_access_token,
    expiresAt: Date.now() + Number(payload.expire || 7200) * 1000,
  }
  return feishuToken.value
}

export function resetFeishuToken() {
  feishuToken = { value: null, expiresAt: 0 }
}

async function sendFeishuApp(notifier, text) {
  const payload = buildFeishuAppPayload(text, notifier.format)
  const post = async (token) => {
    const response = await request(`${FEISHU_API}/im/v1/messages?receive_id_type=open_id`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ receive_id: notifier.openId, ...payload }),
    })
    return await response.json().catch(() => ({}))
  }
  let result = await post(await feishuAppToken(notifier))
  if ([99991661, 99991663, 99991668].includes(result.code)) {
    resetFeishuToken()
    result = await post(await feishuAppToken(notifier, { forceRefresh: true }))
  }
  if (result.code !== 0) throw new Error(`feishu-app ${result.code} ${result.msg || ''}`.trim())
}

/**
 * @param {{kind: string} & Record<string, unknown>} notifier
 * @param {string} text
 * @param {{root: string}} options
 */
export async function sendNotification(notifierId, notifiers, text, { root }) {
  const notifier = notifiers?.[notifierId] || { kind: 'console' }
  if (notifier.kind === 'console') {
    log('notify(console):', text.replace(/\n/g, ' | '))
    return
  }
  if (notifier.kind === 'file') {
    const target = localPath(root, notifier.path || 'data/notifications.log')
    await mkdir(path.dirname(target), { recursive: true })
    await appendFile(target, `\n## ${new Date().toISOString()}\n${text}\n`)
    return
  }
  if (notifier.kind === 'feishu-app') {
    await sendFeishuApp(notifier, text)
    return
  }
  if (notifier.kind === 'dsh-im') {
    const base = String(notifier.baseUrl || 'http://127.0.0.1:3081').replace(/\/$/, '')
    const response = await request(`${base}/api/dsh-im/delivery/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildDshImBody(notifier.botId, notifier.targetId, text, notifier.format)),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload.sent !== true) {
      const code = payload?.error?.code || 'delivery-failed'
      const detail = payload?.error?.message || ''
      throw new Error(`dsh-im ${code}${detail && detail !== code ? ': ' + detail : ''}`)
    }
    return
  }
  if (notifier.kind === 'feishu-webhook') {
    const response = await request(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildFeishuBody(text, notifier.secret)),
    })
    const payload = await response.json().catch(() => ({}))
    if (payload.code && payload.code !== 0) throw new Error(`feishu webhook code ${payload.code} ${payload.msg || ''}`)
    return
  }
  if (notifier.kind === 'webhook') {
    await request(notifier.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(notifier.headers || {}) },
      body: JSON.stringify(notifier.body === undefined ? { text } : notifier.body),
    })
    return
  }
  throw new Error(`unsupported notifier kind: ${notifier.kind}`)
}
