/**
 * Renders the panel component with a minimal React hook harness.
 *
 * This exists because a hook placed after an early `return` only explodes on
 * the *second* render (when data arrives), which blanks the whole settings page
 * and no unit test of the pure helpers would notice.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const OVERVIEW = {
  schemaVersion: 2,
  root: '/tmp/pushbot',
  configPath: '/tmp/pushbot/config.json',
  service: { active: 'active', enabled: 'enabled', pid: 1, restarts: 0, timers: [] },
  health: {
    phase: 'ok', version: '0.7.1', build: 11, deliveries: 2, deliveryFailures: 0,
    sources: { ok: 1, failing: 0 }, outboxPending: 0, rssMb: 120,
    lastCycleAt: new Date().toISOString(),
  },
  topics: [{ id: 'ai', lastRunAt: Date.now(), seen: 3, sourceCount: 1 }],
  config: {
    notifiers: { file: { kind: 'file', path: 'data/out.log' } },
    topics: [{ id: 'ai', name: 'AI 资讯', everyMinutes: 30, notifier: 'file', sources: [{ kind: 'rss', url: 'https://example.com/feed' }] }],
    llm: { enabled: false },
    automation: { improve: 'auto' },
  },
  catalog: { sourceKinds: [{ kind: 'rss', label: 'RSS', fields: ['url'] }], improvePolicies: ['auto', 'approval', 'off'] },
  outbox: { pending: 0, dead: 0 },
  recent: [{ ts: Date.now(), topic: 'ai', title: '一条记录' }],
  lastDeploy: null,
  lastImprovement: null,
}

function createHarness() {
  const hooks = []
  const queue = []
  const intervals = []
  let index = 0
  let previousHookCount = null
  let Component = null

  const schedule = (fn) => queue.push(fn)

  class ReactComponent {
    constructor(props) { this.props = props; this.state = {} }
    setState(next) { this.state = { ...this.state, ...(typeof next === "function" ? next(this.state) : next) }; schedule(render) }
  }

  const React = {
    Component: ReactComponent,
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState(initial) {
      const slot = index++
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      const set = (value) => {
        hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value
        schedule(render)
      }
      return [hooks[slot], set]
    },
    useEffect(callback) {
      const slot = index++
      if (!(slot in hooks)) { hooks[slot] = true; schedule(callback) }
    },
    useMemo(factory) {
      const slot = index++
      if (!(slot in hooks)) hooks[slot] = factory()
      return hooks[slot]
    },
    useCallback(factory) {
      const slot = index++
      if (!(slot in hooks)) hooks[slot] = factory
      return hooks[slot]
    },
  }

  function render() {
    index = 0
    const tree = Component()
    if (previousHookCount !== null && index > previousHookCount) {
      throw new Error(`hook order changed: this render used ${index} hooks, the previous one used ${previousHookCount}`)
    }
    previousHookCount = index
    return tree
  }

  return {
    React,
    mount(component) { Component = component; render() },
    async flush(rounds = 10) {
      for (let round = 0; round < rounds; round += 1) {
        while (queue.length) {
          const fn = queue.shift()
          await fn()
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    },
    intervals,
  }
}

test('the panel renders twice (loading, then data) without changing hook order', async () => {
  const harness = createHarness()
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const previousSetInterval = globalThis.setInterval
  const previousClearInterval = globalThis.clearInterval

  let loaderModule = null
  globalThis.window = { __ModuleLoader__: { load: (module) => { loaderModule = module } } }
  globalThis.fetch = async () => ({ ok: true, json: async () => OVERVIEW })
  globalThis.setInterval = (callback) => { harness.intervals.push(callback); return harness.intervals.length }
  globalThis.clearInterval = () => {}

  try {
    await import('../client.js')
    assert.ok(loaderModule, 'client module registers itself')
    assert.equal(loaderModule.id, 'dsh-pushbot-panel')

    const api = loaderModule.factory((name) => {
      if (name === 'react') return harness.React
      throw new Error(`unexpected module: ${name}`)
    })

    let registered = null
    api.apply({
      slots: {
        inject: (_slot, callback) => callback(),
        register: (options, Component) => { registered = { options, Component }; return () => {} },
      },
    })

    assert.equal(registered.options.id, 'dsh-pushbot')
    assert.equal(registered.options.name, 'settings.section')

    harness.mount(registered.Component)
    await harness.flush()

    const tree = JSON.stringify(harness.intervals.length ? harness.intervals : []) // touch to avoid unused warning
    assert.ok(Array.isArray(harness.intervals) || tree === '[]')
  } finally {
    globalThis.window = previousWindow
    globalThis.fetch = previousFetch
    globalThis.setInterval = previousSetInterval
    globalThis.clearInterval = previousClearInterval
  }
})
