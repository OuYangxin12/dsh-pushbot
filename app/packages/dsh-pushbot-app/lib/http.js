/** Shared fetch helpers with a timeout and a stable user agent. */
export async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(Number(process.env.PUSHBOT_FETCH_TIMEOUT_MS || 15000)),
    headers: {
      'user-agent': 'dsh-pushbot/0.6 (DeepSeek Harness resident service)',
      ...(init.headers || {}),
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  return response
}

export async function fetchText(url, init) {
  return await (await request(url, init)).text()
}

export async function fetchJson(url, init) {
  return await (await request(url, init)).json()
}
