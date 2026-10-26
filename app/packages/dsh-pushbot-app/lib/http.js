/**
 * Fetch helpers: timeout, stable user agent, and a bounded retry for idempotent
 * requests. Delivery POSTs are never retried here — the outbox owns that, and a
 * blind retry could duplicate a message.
 */

const RETRIABLE = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|TimeoutError|AbortError/i

/** Run `task` up to `attempts` times with a linear delay; rethrow the last error. */
export async function retryAsync(task, { attempts = 3, delayMs = 400, isRetriable = () => true } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isRetriable(error)) throw error
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
  throw lastError
}

async function once(url, init, timeoutMs) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': 'dsh-pushbot/0.8 (DeepSeek Harness resident service)',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response
}

/** `HTTP 404` style failures are definitive; network failures are worth a retry. */
function shouldRetry(error) {
  const message = String(error?.message || error)
  return !message.startsWith('HTTP ') && RETRIABLE.test(`${message} ${error?.name || ''}`)
}

export async function request(url, init = {}) {
  const timeoutMs = Number(process.env.PUSHBOT_FETCH_TIMEOUT_MS || 20000)
  const method = String(init.method || 'GET').toUpperCase()
  const attempts = method === 'GET'
    ? Number(process.env.PUSHBOT_FETCH_RETRIES ?? 2) + 1
    : 1
  return retryAsync(
    () => once(url, init, timeoutMs),
    { attempts, delayMs: Number(process.env.PUSHBOT_RETRY_DELAY_MS ?? 500), isRetriable: shouldRetry },
  )
}

export async function fetchText(url, init) {
  return await (await request(url, init)).text()
}

export async function fetchJson(url, init) {
  return await (await request(url, init)).json()
}
