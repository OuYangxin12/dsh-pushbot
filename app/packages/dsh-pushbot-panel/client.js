window.__ModuleLoader__.load({
  id: 'dsh-pushbot-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const T = {
      bg1: 'var(--dsw-alias-bg-layer-1)',
      bg2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    const styles = {
      page: { padding: '20px 24px 48px', maxWidth: 880, color: T.text, fontSize: 13 },
      head: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 },
      title: { fontSize: 16, fontWeight: 600, margin: 0 },
      sub: { color: T.muted, fontSize: 12 },
      card: { background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px', marginTop: 16 },
      cardTitle: { fontSize: 13, fontWeight: 600, marginBottom: 10 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
      metric: { background: T.bg2, borderRadius: 6, padding: '8px 10px' },
      metricLabel: { color: T.muted, fontSize: 11, marginBottom: 2 },
      metricValue: { fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      button: {
        appearance: 'none', border: `1px solid ${T.border2}`, background: T.bg2, color: T.text,
        borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
      },
      buttonPrimary: {
        appearance: 'none', border: `1px solid ${T.brand}`, background: T.brand, color: '#fff',
        borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
      th: { textAlign: 'left', color: T.muted, fontWeight: 500, padding: '6px 8px', borderBottom: `1px solid ${T.border}` },
      td: { padding: '7px 8px', borderBottom: `1px solid ${T.border}`, verticalAlign: 'middle' },
      input: {
        width: 64, background: T.bg2, color: T.text, border: `1px solid ${T.border2}`,
        borderRadius: 5, padding: '3px 6px', fontSize: 12,
      },
      select: {
        background: T.bg2, color: T.text, border: `1px solid ${T.border2}`,
        borderRadius: 5, padding: '3px 6px', fontSize: 12,
      },
      pill: (color) => ({
        display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6,
      }),
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
      listItem: { color: T.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      note: { marginTop: 10, fontSize: 12, color: T.muted, whiteSpace: 'pre-wrap' },
      error: { marginTop: 10, fontSize: 12, color: T.error },
    }

    const statusColor = (phase) => (phase === 'ok' ? T.ok : phase === 'error' ? T.error : phase === 'idle' ? T.idle : T.warn)
    const ago = (iso) => {
      if (!iso) return '—'
      const diff = Math.max(0, Date.now() - Date.parse(iso))
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} 小时前`
      return `${Math.floor(hours / 24)} 天前`
    }

    async function api(path, init) {
      const response = await fetch(`/api/dsh-pushbot${path}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
        ...init,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
      return payload
    }

    function Metric({ label, value, color }) {
      return h('div', { style: styles.metric },
        h('div', { style: styles.metricLabel }, label),
        h('div', { style: { ...styles.metricValue, color: color || T.text } }, value))
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(null)
      const [edits, setEdits] = useState({})
      const [dirty, setDirty] = useState(false)

      const load = useCallback(async () => {
        try {
          const next = await api('/overview')
          setData(next)
          setError(null)
          return next
        } catch (cause) {
          setError(cause.message)
          return null
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(() => { void load() }, 5000)
        return () => clearInterval(timer)
      }, [load])

      const patchTopic = (id, field, value) => {
        setEdits((current) => ({ ...current, [id]: { ...(current[id] || {}), [field]: value } }))
        setDirty(true)
        setNote(null)
      }

      const save = async () => {
        setBusy('save')
        try {
          const topics = Object.entries(edits).map(([id, change]) => ({ id, ...change }))
          await api('/config', { method: 'POST', body: JSON.stringify({ topics }) })
          setEdits({})
          setDirty(false)
          setNote('已保存。pushbot 下一轮会自动读取新配置，不需要重启。')
          await load()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(null)
        }
      }

      const action = async (name) => {
        setBusy(name)
        setNote(null)
        try {
          const result = await api('/action', { method: 'POST', body: JSON.stringify({ action: name }) })
          setNote(result.output || result.hint || (result.ok === false ? result.error : '已触发'))
          if (name === 'test-push' && result.ok === false) setError(result.error || '测试推送失败')
          await load()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(null)
        }
      }

      if (!data) {
        return h('div', { style: styles.page },
          h('div', { style: styles.sub }, error ? `读取失败：${error}` : '正在读取 pushbot 状态…'))
      }

      const health = data.health || {}
      const service = data.service || {}
      const running = service.active === 'active'
      const topicRows = data.topics.map((topic) => {
        const change = edits[topic.id] || {}
        const disabled = change.disabled ?? topic.disabled
        const every = change.everyMinutes ?? topic.everyMinutes
        const notifier = change.notifier ?? topic.notifier
        return h('tr', { key: topic.id },
          h('td', { style: styles.td },
            h('div', { style: { fontWeight: 500 } }, topic.name),
            h('div', { style: styles.sub }, `${topic.sourceCount} 个源 · ${topic.sources.join('/') || '无'}`)),
          h('td', { style: styles.td },
            h('input', {
              style: styles.input, type: 'number', min: 1, max: 1440, value: every,
              onChange: (event) => patchTopic(topic.id, 'everyMinutes', Number(event.target.value)),
            })),
          h('td', { style: styles.td },
            h('select', {
              style: styles.select, value: notifier,
              onChange: (event) => patchTopic(topic.id, 'notifier', event.target.value),
            }, data.notifiers.map((row) => h('option', { key: row.id, value: row.id }, `${row.id} (${row.kind})`)))),
          h('td', { style: styles.td },
            h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
              h('input', {
                type: 'checkbox', checked: !disabled,
                onChange: (event) => patchTopic(topic.id, 'disabled', !event.target.checked),
              }),
              h('span', null, disabled ? '暂停' : '启用'))),
          h('td', { style: { ...styles.td, color: T.muted, fontVariantNumeric: 'tabular-nums' } }, String(topic.seen)),
          h('td', { style: { ...styles.td, color: T.muted } }, ago(topic.lastRunAt ? new Date(topic.lastRunAt).toISOString() : null)))
      })

      return h('div', { style: styles.page },
        h('div', { style: styles.head },
          h('h2', { style: styles.title }, 'Pushbot'),
          h('span', { style: styles.sub }, `${data.root} · ${data.configPath}`)),
        h('div', { style: styles.sub },
          h('span', { style: styles.pill(running ? T.ok : T.error) }),
          running ? '服务运行中' : `服务未运行（${service.active || 'unknown'}）`,
          ` · 版本 ${health.version || '?'} · 构建 ${health.build ?? '?'}`,
          ` · 重启 ${service.restarts ?? 0} 次`),

        h('div', { style: { ...styles.card, marginTop: 12 } },
          h('div', { style: styles.grid },
            h(Metric, { label: '心跳', value: health.phase || '—', color: statusColor(health.phase) }),
            h(Metric, { label: '上次抓取', value: ago(health.lastCycleAt) }),
            h(Metric, { label: '投递队列', value: `${data.outbox.pending} / ${data.outbox.dead}`, color: data.outbox.dead > 0 ? T.warn : T.text }),
            h(Metric, { label: '源成功/失败', value: `${health.sources?.ok ?? 0} / ${health.sources?.failing ?? 0}`, color: (health.sources?.failing ?? 0) > 0 ? T.warn : T.text }),
            h(Metric, { label: '累计投递', value: String(health.deliveries ?? 0) }),
            h(Metric, { label: '内存', value: `${health.rssMb ?? 0} MB` })),
          h('div', { style: { ...styles.row, marginTop: 12 } },
            h('button', { style: styles.buttonPrimary, disabled: busy === 'run-once', onClick: () => void action('run-once') },
              busy === 'run-once' ? '运行中…' : '立即运行一轮'),
            h('button', { style: styles.button, disabled: busy === 'test-push', onClick: () => void action('test-push') },
              busy === 'test-push' ? '发送中…' : '测试推送'),
            h('button', { style: styles.button, disabled: busy === 'restart', onClick: () => void action('restart') },
              busy === 'restart' ? '重启中…' : '重启服务'),
            h('button', { style: styles.button, disabled: busy === 'improve', onClick: () => void action('improve') },
              busy === 'improve' ? '已触发' : '跑一次自改进'),
            h('button', { style: styles.button, onClick: () => void load() }, '刷新')),
          note && h('div', { style: styles.note }, note),
          error && h('div', { style: styles.error }, error)),

        h('div', { style: styles.card },
          h('div', { style: styles.row, justifyContent: 'space-between' },
            h('div', { style: styles.cardTitle }, '主题'),
            dirty && h('span', { style: styles.sub }, '有未保存改动')),
          h('table', { style: styles.table },
            h('thead', null, h('tr', null,
              ['主题', '间隔（分钟）', '通道', '状态', '已见', '上次'].map((label) =>
                h('th', { key: label, style: styles.th }, label)))),
            h('tbody', null, topicRows.length ? topicRows : h('tr', null,
              h('td', { style: styles.td, colSpan: 6 }, '还没有配置任何主题')))),
          h('div', { style: { ...styles.row, marginTop: 12 } },
            h('button', { style: styles.buttonPrimary, disabled: !dirty || busy === 'save', onClick: () => void save() },
              busy === 'save' ? '保存中…' : '保存改动'),
            h('span', { style: styles.sub }, '保存后下一轮自动生效，不需要重启服务'))),

        h('div', { style: styles.card },
          h('div', { style: styles.cardTitle }, '最近推送'),
          h('ul', { style: styles.list },
            (data.recent || []).length
              ? data.recent.map((row, index) => h('li', { key: index, style: styles.listItem },
                `${new Date(row.ts).toLocaleTimeString()} · [${row.topic}] ${row.title}`))
              : h('li', { style: styles.listItem }, '暂无记录'))),

        (data.lastImprovement || data.lastDeploy) && h('div', { style: styles.card },
          h('div', { style: styles.cardTitle }, '最近变更'),
          data.lastDeploy && h('div', { style: styles.sub },
            `部署：${data.lastDeploy.target || '?'} at ${new Date(data.lastDeploy.at).toLocaleString()}`),
          data.lastImprovement && h('div', { style: styles.sub },
            `自改进：${data.lastImprovement.verdict}${data.lastImprovement.deployed ? '（已发布）' : '（未发布）'} at ${new Date(data.lastImprovement.at).toLocaleString()}`))
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-pushbot',
          order: 30,
          label: () => 'Pushbot',
          icon: 'bell',
        }, Panel))
      },
    }
  },
})
