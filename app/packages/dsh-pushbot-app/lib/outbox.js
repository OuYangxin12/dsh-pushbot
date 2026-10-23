/**
 * Durable delivery queue: every digest is enqueued before it is sent, so a
 * failed or interrupted delivery is retried instead of lost.
 */

export function emptyOutbox() {
  return { pending: [], dead: [] }
}

export function enqueue(outbox, entry, now = Date.now()) {
  outbox.pending ??= []
  outbox.pending.push({
    id: entry.id,
    topicId: entry.topicId,
    notifier: entry.notifier,
    text: entry.text,
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
  })
  return outbox
}

export function dueEntries(outbox, now = Date.now()) {
  return (outbox.pending || []).filter((entry) => Number(entry.nextAttemptAt || 0) <= now)
}

export function markSent(outbox, id) {
  outbox.pending = (outbox.pending || []).filter((entry) => entry.id !== id)
  return outbox
}

function defaultBackoff(attempts) {
  const exponent = Math.max(0, Number(attempts || 0) - 1)
  return Math.min(60000 * 2 ** exponent, 1800000)
}

/** Move to `dead` (kept for inspection) once the attempt budget is exhausted. */
export function markFailed(outbox, id, error, now = Date.now(), maxAttempts = 8, backoff = defaultBackoff) {
  const entry = (outbox.pending || []).find((row) => row.id === id)
  if (!entry) return outbox
  entry.attempts = Number(entry.attempts || 0) + 1
  entry.lastError = String(error?.message || error || 'unknown error').slice(0, 300)
  if (entry.attempts >= maxAttempts) {
    outbox.pending = outbox.pending.filter((row) => row.id !== id)
    outbox.dead ??= []
    outbox.dead.push(entry)
    outbox.dead = outbox.dead.slice(-50)
  } else {
    entry.nextAttemptAt = now + backoff(entry.attempts)
  }
  return outbox
}

export function pendingCount(outbox) {
  return (outbox.pending || []).length
}
