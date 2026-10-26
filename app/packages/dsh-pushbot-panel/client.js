window.__ModuleLoader__.load({
  id: 'dsh-pushbot-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const T = {
      bg1: 'var(--dsw-alias-bg-layer-1)', bg2: 'var(--dsw-alias-bg-layer-2)', bgOverlay: 'var(--dsw-alias-bg-overlay)',
      border: 'var(--dsw-alias-border-l1)', border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)', muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)', ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)', error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    const S = {
      page: { padding: '20px 24px 48px', maxWidth: 940, color: T.text, fontSize: 13 },
      row: (extra) => ({ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', ...extra }),
      card: { background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 8, padding: '14px 16px', marginTop: 14 },
      cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
      title: { fontSize: 13, fontWeight: 600, margin: 0 },
      h2: { fontSize: 16, fontWeight: 600, margin: '0 0 2px' },
      sub: { color: T.muted, fontSize: 12 },
      grid: (min) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 10 }),
      metric: { background: T.bg2, borderRadius: 6, padding: '8px 10px' },
      metricLabel: { color: T.muted, fontSize: 11, marginBottom: 2 },
      metricValue: { fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      button: { appearance: 'none', border: `1px solid ${T.border2}`, background: T.bg2, color: T.text, borderRadius: 6, padding: '5px 11px', fontSize: 12, cursor: 'pointer' },
      buttonPrimary: { appearance: 'none', border: `1px solid ${T.brand}`, background: T.brand, color: '#fff', borderRadius: 6, padding: '5px 11px', fontSize: 12, cursor: 'pointer' },
      buttonGhost: { appearance: 'none', border: '1px solid transparent', background: 'transparent', color: T.muted, borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' },
      input: { background: T.bg2, color: T.text, border: `1px solid ${T.border2}`, borderRadius: 5, padding: '4px 7px', fontSize: 12, minWidth: 0 },
      inputWide: { background: T.bg2, color: T.text, border: `1px solid ${T.border2}`, borderRadius: 5, padding: '4px 7px', fontSize: 12, width: '100%', boxSizing: 'border-box' },
      select: { background: T.bg2, color: T.text, border: `1px solid ${T.border2}`, borderRadius: 5, padding: '4px 7px', fontSize: 12 },
      label: { color: T.muted, fontSize: 11, display: 'block', marginBottom: 3 },
      field: { display: 'flex', flexDirection: 'column', minWidth: 0 },
      tabs: { display: 'flex', gap: 4, borderBottom: `1px solid ${T.border}`, margin: '14px 0 0' },
      tab: (active) => ({
        appearance: 'none', background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? T.brand : 'transparent'}`,
        color: active ? T.text : T.muted, padding: '7px 10px', fontSize: 12, cursor: 'pointer', marginBottom: -1,
      }),
      pill: (color) => ({ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color, marginRight: 6 }),
      sourceRow: { border: `1px solid ${T.border}`, borderRadius: 6, padding: 10, marginTop: 8, background: T.bg2 },
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 },
      listItem: { color: T.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      note: { marginTop: 10, fontSize: 12, color: T.muted, whiteSpace: 'pre-wrap' },
      error: { marginTop: 10, fontSize: 12, color: T.error },
      banner: { marginTop: 12, padding: '10px 12px', borderRadius: 6, border: `1px solid ${T.border2}`, background: T.bg2, color: T.muted, fontSize: 12 },
      catCard: { border: `1px solid ${T.border}`, borderRadius: 6, padding: 10, background: T.bg2, display: 'flex', flexDirection: 'column', gap: 6 },
    }

    // Only entries verified to respond were shipped as one-click; the rest are
    // templates that ask for the site-specific fields first.
    const CATALOG = [
      { id: 'hn-front', category: '资讯', name: 'Hacker News 首页', description: '官方 RSS，tech 圈最热讨论', topicName: 'Hacker News', everyMinutes: 30, source: { kind: 'rss', url: 'https://hnrss.org/frontpage', limit: 10 } },
      { id: 'openai-news', category: '资讯', name: 'OpenAI 新闻', description: '官方 RSS', topicName: 'OpenAI', everyMinutes: 60, source: { kind: 'rss', url: 'https://openai.com/news/rss.xml', limit: 10 } },
      { id: 'cloudflare-blog', category: '资讯', name: 'Cloudflare 博客', description: '工程与网络', topicName: 'Cloudflare', everyMinutes: 120, source: { kind: 'rss', url: 'https://blog.cloudflare.com/rss/', limit: 10 } },
      { id: 'simonwillison', category: '资讯', name: 'Simon Willison', description: 'LLM 与工程随笔', topicName: 'Simon Willison', everyMinutes: 60, source: { kind: 'atom', url: 'https://simonwillison.net/atom/everything/', limit: 10 } },
      { id: 'solidot', category: '资讯', name: 'Solidot 奇客', description: '中文科技资讯', topicName: 'Solidot', everyMinutes: 60, source: { kind: 'rss', url: 'https://www.solidot.org/index.rss', limit: 10 } },
      { id: 'sspai', category: '资讯', name: '少数派', description: '效率与数字生活', topicName: '少数派', everyMinutes: 120, source: { kind: 'rss', url: 'https://sspai.com/feed', limit: 10 } },
      { id: 'ruanyifeng', category: '资讯', name: '阮一峰博客', description: '技术周刊与随笔', topicName: '阮一峰', everyMinutes: 180, source: { kind: 'atom', url: 'https://www.ruanyifeng.com/blog/atom.xml', limit: 10 } },
      { id: 'github-blog', category: '资讯', name: 'GitHub 博客', description: '产品与工程公告', topicName: 'GitHub 博客', everyMinutes: 180, source: { kind: 'rss', url: 'https://github.blog/feed/', limit: 10 } },
      { id: 'hn-top', category: '榜单', name: 'Hacker News 热榜', description: '官方 Firebase API', topicName: 'HN 热榜', everyMinutes: 30, source: { kind: 'hackernews', limit: 10 } },
      { id: 'hn-keyword', category: '榜单', name: 'HN 关键词搜索', description: '按时间倒序搜 HN', topicName: 'HN 关键词', everyMinutes: 60, requires: [{ key: 'query', label: '关键词', value: 'deepseek' }], source: { kind: 'hn-search', query: 'deepseek', sinceDays: 3, limit: 10 } },
      { id: 'gh-trending', category: '榜单', name: 'GitHub 热门新仓库', description: '近 7 天新建、按 star 排序', topicName: 'GitHub 热门', everyMinutes: 180, source: { kind: 'github-search', query: 'created:>{since} stars:>200', sinceDays: 7, limit: 8 } },
      { id: 'v2ex-hot', category: '社区', name: 'V2EX 热帖', description: '官方热帖接口', topicName: 'V2EX', everyMinutes: 60, source: { kind: 'v2ex', limit: 10 } },
      { id: 'tpl-github-release', category: '模板', name: 'GitHub 仓库发布', description: '盯某个仓库的 release', topicName: '仓库发布', everyMinutes: 60, requires: [{ key: 'repo', label: '仓库 owner/repo', value: 'deepseek-ai/deepseek-harness' }], source: { kind: 'github', repo: '', events: ['release'], limit: 3 } },
      { id: 'tpl-page-change', category: '模板', name: '网页内容变更', description: '页面内容变了就推', topicName: '网页监控', everyMinutes: 60, requires: [{ key: 'url', label: '页面地址', value: '' }], source: { kind: 'page', url: '', name: '监控页' } },
      { id: 'tpl-page-expect', category: '模板', name: '网页状态断言', description: '例如「现货」消失、「缺货」出现时提醒', topicName: '状态监控', everyMinutes: 60, requires: [{ key: 'url', label: '页面地址', value: '' }, { key: 'expect.contains', label: '必须包含的文字', value: '现货' }], source: { kind: 'page', url: '', name: '状态', expect: { contains: '现货' } } },
      { id: 'tpl-html-list', category: '模板', name: '任意网页列表', description: '用正则从 HTML 提取标题与链接', topicName: '网页列表', everyMinutes: 60, requires: [{ key: 'url', label: '页面地址', value: '' }, { key: 'item', label: '条目正则（捕获块）', value: '<li>([\\s\\S]*?)</li>' }, { key: 'title', label: '标题正则', value: '<h2>([\\s\\S]*?)</h2>' }], source: { kind: 'html-list', url: '', item: '<li>([\\s\\S]*?)</li>', title: '<h2>([\\s\\S]*?)</h2>', link: 'href="([^"]+)"', limit: 10 } },
      { id: 'tpl-json-api', category: '模板', name: '任意 JSON 接口', description: '用点号路径映射字段', topicName: '接口监控', everyMinutes: 60, requires: [{ key: 'url', label: '接口地址', value: '' }, { key: 'itemsPath', label: '数组路径', value: 'data.list' }], source: { kind: 'json-api', url: '', itemsPath: 'data.list', titlePath: 'title', urlPath: 'url', limit: 10 } },
    ]

    const FIELD_LABELS = {
      url: { label: '地址', placeholder: 'https://…' },
      repo: { label: '仓库', placeholder: 'owner/repo' },
      query: { label: '查询', placeholder: 'deepseek / created:>{since} stars:>200' },
      events: { label: '事件', placeholder: 'release,commit' },
      limit: { label: '条数', type: 'number' },
      sinceDays: { label: '天数', type: 'number' },
      sort: { label: '排序', placeholder: 'stars' },
      region: { label: '区域正则', placeholder: '<main[\\s\\S]*?</main>' },
      item: { label: '条目正则', placeholder: '<li>([\\s\\S]*?)</li>' },
      title: { label: '标题正则', placeholder: '<h2>([\\s\\S]*?)</h2>' },
      link: { label: '链接正则', placeholder: 'href="([^"]+)"' },
      summary: { label: '摘要正则' },
      name: { label: '显示名' },
      itemsPath: { label: '数组路径', placeholder: 'data.list' },
      titlePath: { label: '标题字段', placeholder: 'title' },
      urlPath: { label: '链接字段', placeholder: 'url' },
      idPath: { label: 'ID 字段', placeholder: 'id' },
      datePath: { label: '时间字段', placeholder: 'created_at' },
      summaryPath: { label: '摘要字段', placeholder: 'description' },
      'expect.contains': { label: '必须包含', placeholder: '现货' },
      'expect.absent': { label: '不能出现', placeholder: '缺货' },
    }

    const CATEGORY_GROUPS = (() => {
      const groups = new Map()
      for (const entry of CATALOG) {
        if (!groups.has(entry.category)) groups.set(entry.category, [])
        groups.get(entry.category).push(entry)
      }
      return [...groups.entries()]
    })()

    const K = {
      clone: (value) => JSON.parse(JSON.stringify(value)),
      setPath: (target, dotted, value) => {
        const parts = String(dotted).split('.')
        let node = target
        for (const part of parts.slice(0, -1)) {
          node[part] = node[part] && typeof node[part] === 'object' ? node[part] : {}
          node = node[part]
        }
        node[parts.at(-1)] = value
      },
      ago: (value) => {
        if (!value) return '—'
        const minutes = Math.floor(Math.max(0, Date.now() - Number(value)) / 60000)
        if (minutes < 1) return '刚刚'
        if (minutes < 60) return `${minutes} 分钟前`
        const hours = Math.floor(minutes / 60)
        return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`
      },
      agoIso: (iso) => (iso ? K.ago(Date.parse(iso)) : '—'),
    }

    const statusColor = (phase) => (phase === 'ok' ? T.ok : phase === 'error' ? T.error : phase === 'idle' ? T.idle : T.warn)

    async function api(path, init) {
      const response = await fetch(`/api/dsh-pushbot${path}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
        ...init,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const detail = payload.error || `HTTP ${response.status}`
        throw new Error(detail)
      }
      return payload
    }

    function Field({ label, value, onChange, placeholder, type = 'text', style }) {
      return h('label', { style: { ...S.field, ...(style || {}) } },
        h('span', { style: S.label }, label),
        h('input', {
          style: S.input, type, value: value ?? '', placeholder,
          onChange: (event) => onChange(type === 'number' ? Number(event.target.value) : event.target.value),
        }))
    }

    function Metric({ label, value, color }) {
      return h('div', { style: S.metric },
        h('div', { style: S.metricLabel }, label),
        h('div', { style: { ...S.metricValue, color: color || T.text } }, value))
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [draft, setDraft] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [tab, setTab] = useState('overview')
      const [busy, setBusy] = useState(null)
      const [note, setNote] = useState(null)
      const [error, setError] = useState(null)
      const [catalogInputs, setCatalogInputs] = useState({})
      const [addTarget, setAddTarget] = useState('')
      const [newSourceKind, setNewSourceKind] = useState('rss')

      const hostReady = Boolean(data?.schemaVersion && data.schemaVersion >= 2)

      const load = useCallback(async () => {
        try {
          const next = await api('/overview')
          setData(next)
          setError(null)
          setDraft((current) => (current && dirty ? current : K.clone(next.config || { topics: [] })))
          if (!addTarget && next.config?.topics?.length) setAddTarget(next.config.topics[0].id)
          return next
        } catch (cause) {
          setError(cause.message)
          return null
        }
      }, [dirty, addTarget])

      useEffect(() => {
        void load()
        const timer = setInterval(() => { void load() }, 5000)
        return () => clearInterval(timer)
      }, [load])

      const edit = (mutator) => {
        setDraft((current) => {
          if (!current) return current
          const next = K.clone(current)
          mutator(next)
          return next
        })
        setDirty(true)
        setNote(null)
      }

      const save = async () => {
        setBusy('save')
        setError(null)
        try {
          const result = await api('/config', { method: 'POST', body: JSON.stringify({ config: draft }) })
          setDirty(false)
          setDraft(K.clone(result.config))
          setNote('已保存。pushbot 下一轮会自动读取新配置，不需要重启服务。')
          await load()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(null)
        }
      }

      const run = async (name) => {
        setBusy(name)
        setNote(null)
        setError(null)
        try {
          const result = await api('/action', { method: 'POST', body: JSON.stringify({ action: name }) })
          setNote(result.output || result.hint || (result.ok === false ? result.error : '已触发'))
          if (result.ok === false) setError(result.error || '操作失败')
          await load()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(null)
        }
      }

      const notifierIds = useMemo(() => Object.keys(draft?.notifiers || data?.config?.notifiers || {}), [draft, data])
      const sourceKinds = data?.catalog?.sourceKinds || []
      if (!data) {
        return h('div', { style: S.page }, h('div', { style: S.sub }, error ? `读取失败：${error}` : '正在读取 pushbot 状态…'))
      }

      const health = data.health || {}
      const service = data.service || {}
      const running = service.active === 'active'

      const tabs = [['overview', '概览'], ['topics', '主题'], ['prefs', '偏好'], ['catalog', '源目录']]

      // ---------- overview ----------
      const topicStats = new Map((data.topics || []).map((row) => [row.id, row]))
      const overview = [
        h('div', { style: S.card },
          h('div', { style: S.grid(120) },
            h(Metric, { label: '心跳', value: health.phase || '—', color: statusColor(health.phase) }),
            h(Metric, { label: '上次抓取', value: K.agoIso(health.lastCycleAt) }),
            h(Metric, { label: '投递队列', value: `${data.outbox?.pending ?? 0} / ${data.outbox?.dead ?? 0}`, color: (data.outbox?.dead ?? 0) ? T.warn : T.text }),
            h(Metric, { label: '源成功/失败', value: `${health.sources?.ok ?? 0} / ${health.sources?.failing ?? 0}`, color: (health.sources?.failing ?? 0) ? T.warn : T.text }),
            h(Metric, { label: '累计投递', value: String(health.deliveries ?? 0) }),
            h(Metric, { label: '内存', value: `${health.rssMb ?? 0} MB` })),
          h('div', { style: S.row({ marginTop: 12 }) },
            h('button', { style: S.buttonPrimary, disabled: busy === 'run-once', onClick: () => void run('run-once') }, busy === 'run-once' ? '运行中…' : '立即运行一轮'),
            h('button', { style: S.button, disabled: busy === 'test-push', onClick: () => void run('test-push') }, busy === 'test-push' ? '发送中…' : '测试推送'),
            h('button', { style: S.button, disabled: busy === 'restart', onClick: () => void run('restart') }, busy === 'restart' ? '重启中…' : '重启服务'),
            h('button', { style: S.button, disabled: busy === 'improve', onClick: () => void run('improve') }, busy === 'improve' ? '已触发' : '跑一次自改进'))),
        h('div', { style: S.card },
          h('div', { style: S.title }, '最近推送'),
          h('ul', { style: S.list },
            (data.recent || []).length
              ? data.recent.map((row, index) => h('li', { key: index, style: S.listItem }, `${new Date(row.ts).toLocaleTimeString()} · [${row.topic}] ${row.title}`))
              : h('li', { style: S.listItem }, '暂无记录'))),
      ]

      // ---------- topics ----------
      const topicsView = draft ? [
        h('div', { style: S.row({ marginTop: 14, justifyContent: 'space-between' }) },
          h('span', { style: S.sub }, `${draft.topics.length} 个主题 · 改动后点右侧保存`),
          h('div', { style: S.row() },
            h('button', {
              style: S.button,
              onClick: () => edit((cfg) => cfg.topics.push({
                id: `topic-${cfg.topics.length + 1}`, name: `新主题 ${cfg.topics.length + 1}`,
                everyMinutes: 30, notifier: notifierIds[0], sources: [{ kind: 'hackernews', limit: 8 }],
              })),
            }, '新增主题'),
            h('button', { style: S.buttonPrimary, disabled: !dirty || busy === 'save', onClick: () => void save() },
              busy === 'save' ? '保存中…' : '保存改动'))),
        ...draft.topics.map((topic, topicIndex) => {
          const stat = topicStats.get(topic.id) || {}
          return h('div', { key: topicIndex, style: S.card },
            h('div', { style: S.cardHead },
              h('div', { style: S.row({ flex: 1 }) },
                h('input', {
                  style: { ...S.input, width: 160 }, value: topic.name || '',
                  onChange: (event) => edit((cfg) => { cfg.topics[topicIndex].name = event.target.value }),
                }),
                h('label', { style: S.row({ gap: 4, cursor: 'pointer' }) },
                  h('input', {
                    type: 'checkbox', checked: !topic.disabled,
                    onChange: (event) => edit((cfg) => {
                      const target = cfg.topics[topicIndex]
                      if (event.target.checked) delete target.disabled
                      else target.disabled = true
                    }),
                  }),
                  h('span', { style: S.sub }, topic.disabled ? '已暂停' : '启用'))),
              h('div', { style: S.row() },
                h('span', { style: S.sub }, `已见 ${stat.seen ?? 0} · ${K.ago(stat.lastRunAt)}`),
                h('button', {
                  style: S.buttonGhost,
                  onClick: () => {
                    if (!window.confirm(`删除主题「${topic.name || topic.id}」？`)) return
                    edit((cfg) => cfg.topics.splice(topicIndex, 1))
                  },
                }, '删除'))),
            h('div', { style: { ...S.grid(140), marginBottom: 8 } },
              h(Field, {
                label: '间隔（分钟）', type: 'number', value: topic.everyMinutes,
                onChange: (value) => edit((cfg) => { cfg.topics[topicIndex].everyMinutes = value }),
              }),
              h('label', { style: S.field },
                h('span', { style: S.label }, '通道'),
                h('select', {
                  style: S.select, value: topic.notifier || notifierIds[0],
                  onChange: (event) => edit((cfg) => { cfg.topics[topicIndex].notifier = event.target.value }),
                }, notifierIds.map((id) => h('option', { key: id, value: id }, id)))),
              h(Field, {
                label: '免打扰开始', value: (topic.quietHours || ['', ''])[0], placeholder: '23:30',
                onChange: (value) => edit((cfg) => {
                  const target = cfg.topics[topicIndex]
                  const end = (target.quietHours || ['', ''])[1]
                  target.quietHours = [value, end]
                  if (!value && !end) delete target.quietHours
                }),
              }),
              h(Field, {
                label: '免打扰结束', value: (topic.quietHours || ['', ''])[1], placeholder: '07:30',
                onChange: (value) => edit((cfg) => {
                  const target = cfg.topics[topicIndex]
                  const start = (target.quietHours || ['', ''])[0]
                  target.quietHours = [start, value]
                  if (!value && !start) delete target.quietHours
                }),
              })),
            h('div', { style: S.grid(200) },
              h(Field, {
                label: '必须包含关键词（逗号分隔）', placeholder: 'AI, deepseek',
                value: (topic.filter?.includeAny || []).join(','),
                onChange: (value) => edit((cfg) => {
                  const target = cfg.topics[topicIndex]
                  const words = value.split(',').map((word) => word.trim()).filter(Boolean)
                  target.filter = { ...(target.filter || {}), includeAny: words }
                  if (!words.length) delete target.filter.includeAny
                  if (!target.filter.includeAny && !target.filter.excludeAny) delete target.filter
                }),
              }),
              h(Field, {
                label: '排除关键词（逗号分隔）', placeholder: '招聘, 广告',
                value: (topic.filter?.excludeAny || []).join(','),
                onChange: (value) => edit((cfg) => {
                  const target = cfg.topics[topicIndex]
                  const words = value.split(',').map((word) => word.trim()).filter(Boolean)
                  target.filter = { ...(target.filter || {}), excludeAny: words }
                  if (!words.length) delete target.filter.excludeAny
                  if (!target.filter.includeAny && !target.filter.excludeAny) delete target.filter
                }),
              })),

            h('div', { style: { ...S.title, margin: '12px 0 2px' } }, '抓取源'),
            ...(topic.sources || []).map((source, sourceIndex) => {
              const meta = sourceKinds.find((row) => row.kind === source.kind)
              const fields = (meta?.fields || []).filter((field) => field !== 'expect')
              return h('div', { key: sourceIndex, style: S.sourceRow },
                h('div', { style: S.cardHead },
                  h('span', { style: { fontWeight: 500 } }, `${meta?.label || source.kind} · ${source.kind}`),
                  h('button', {
                    style: S.buttonGhost,
                    onClick: () => edit((cfg) => cfg.topics[topicIndex].sources.splice(sourceIndex, 1)),
                  }, '移除')),
                h('div', { style: S.grid(150) },
                  ...fields.map((field) => {
                    const label = FIELD_LABELS[field]?.label || field
                    const isNumber = ['limit', 'sinceDays'].includes(field)
                    const raw = field === 'events' ? (source.events || []).join(',') : source[field]
                    return h(Field, {
                      key: field, label, type: isNumber ? 'number' : 'text',
                      placeholder: FIELD_LABELS[field]?.placeholder,
                      value: raw ?? '',
                      onChange: (value) => edit((cfg) => {
                        const target = cfg.topics[topicIndex].sources[sourceIndex]
                        if (field === 'events') { target.events = String(value).split(',').map((v) => v.trim()).filter(Boolean); return }
                        if (isNumber) { target[field] = Number(value); return }
                        if (value === '') delete target[field]
                        else target[field] = value
                      }),
                    })
                  }),
                  source.kind === 'page' ? h(Field, {
                    label: '必须包含（留空不管）', value: source.expect?.contains || '',
                    onChange: (value) => edit((cfg) => {
                      const target = cfg.topics[topicIndex].sources[sourceIndex]
                      target.expect = { ...(target.expect || {}), contains: value }
                      if (!value) delete target.expect.contains
                      if (!target.expect.contains && !target.expect.absent) delete target.expect
                    }),
                  }) : null,
                  source.kind === 'page' ? h(Field, {
                    label: '不能出现', value: source.expect?.absent || '',
                    onChange: (value) => edit((cfg) => {
                      const target = cfg.topics[topicIndex].sources[sourceIndex]
                      target.expect = { ...(target.expect || {}), absent: value }
                      if (!value) delete target.expect.absent
                      if (!target.expect.contains && !target.expect.absent) delete target.expect
                    }),
                  }) : null))
            }),
            h('div', { style: S.row({ marginTop: 10 }) },
              h('select', { style: S.select, value: newSourceKind, onChange: (event) => setNewSourceKind(event.target.value) },
                sourceKinds.map((row) => h('option', { key: row.kind, value: row.kind }, `${row.label}（${row.kind}）`))),
              h('button', {
                style: S.button,
                onClick: () => edit((cfg) => {
                  cfg.topics[topicIndex].sources.push({ kind: newSourceKind, ...(newSourceKind === 'hackernews' ? { limit: 8 } : {}) })
                }),
              }, '添加空源（填字段后保存）'),
              h('span', { style: S.sub }, '也可以去「源目录」一键添加')))
        })
      ] : []

      // ---------- preferences ----------
      const prefsView = draft ? [
        h('div', { style: S.card },
          h('div', { style: S.cardHead },
            h('div', { style: S.title }, 'LLM 摘要'),
            h('label', { style: S.row({ gap: 6, cursor: 'pointer' }) },
              h('input', {
                type: 'checkbox', checked: Boolean(draft.llm?.enabled),
                onChange: (event) => edit((cfg) => { cfg.llm = { ...(cfg.llm || {}), enabled: event.target.checked } }),
              }),
              h('span', { style: S.sub }, draft.llm?.enabled ? '已开启' : '关闭（用规则摘要）'))),
          h('div', { style: S.grid(180) },
            h(Field, { label: '模型', value: draft.llm?.model || 'deepseek-chat', onChange: (value) => edit((cfg) => { cfg.llm = { ...(cfg.llm || {}), model: value } }) }),
            h(Field, { label: '接口地址', value: draft.llm?.baseUrl || 'https://api.deepseek.com', onChange: (value) => edit((cfg) => { cfg.llm = { ...(cfg.llm || {}), baseUrl: value } }) }),
            h(Field, { label: '密钥环境变量', value: draft.llm?.apiKeyEnv || 'PUSHBOT_LLM_API_KEY', onChange: (value) => edit((cfg) => { cfg.llm = { ...(cfg.llm || {}), apiKeyEnv: value } }) }),
            h(Field, { label: '每日调用上限', type: 'number', value: draft.llm?.maxCallsPerDay ?? 20, onChange: (value) => edit((cfg) => { cfg.llm = { ...(cfg.llm || {}), maxCallsPerDay: value } }) })),
          h('div', { style: { ...S.sub, marginTop: 8 } }, '没配密钥或调用失败会自动降级为规则摘要，不会漏推。')),

        h('div', { style: S.card },
          h('div', { style: S.cardHead },
            h('div', { style: S.title }, '每日日报'),
            h('label', { style: S.row({ gap: 6, cursor: 'pointer' }) },
              h('input', {
                type: 'checkbox', checked: Boolean(draft.dailyReport),
                onChange: (event) => edit((cfg) => {
                  if (event.target.checked) cfg.dailyReport = { at: '09:00', notifier: notifierIds[0] }
                  else delete cfg.dailyReport
                }),
              }),
              h('span', { style: S.sub }, draft.dailyReport ? '已开启' : '关闭'))),
          draft.dailyReport && h('div', { style: S.grid(140) },
            h(Field, { label: '时间 HH:MM', value: draft.dailyReport.at, onChange: (value) => edit((cfg) => { cfg.dailyReport.at = value }) }),
            h('label', { style: S.field },
              h('span', { style: S.label }, '通道'),
              h('select', {
                style: S.select, value: draft.dailyReport.notifier,
                onChange: (event) => edit((cfg) => { cfg.dailyReport.notifier = event.target.value }),
              }, notifierIds.map((id) => h('option', { key: id, value: id }, id)))))),

        h('div', { style: S.card },
          h('div', { style: S.title }, '自改进'),
          h('div', { style: { ...S.grid(240), marginTop: 8 } },
            h('label', { style: S.field },
              h('span', { style: S.label }, '自治级别'),
              h('select', {
                style: S.select, value: draft.automation?.improve || 'auto',
                onChange: (event) => edit((cfg) => { cfg.automation = { improve: event.target.value } }),
              },
              h('option', { value: 'auto' }, 'auto — 低风险自动发布'),
              h('option', { value: 'approval' }, 'approval — 只出提案，等人批'),
              h('option', { value: 'off' }, 'off — 夜间不跑')))),
          h('div', { style: { ...S.sub, marginTop: 8 } }, '机械门禁与冻结校验始终生效；这里只决定「通过门禁后」是否自动发布。')),

        h('div', { style: S.card },
          h('div', { style: S.title }, '通道'),
          h('div', { style: { ...S.sub, marginTop: 6 } }, '通道与密钥由配置脚本管理（面板只读）：'),
          h('ul', { style: S.list },
            Object.entries(draft.notifiers || {}).map(([id, row]) =>
              h('li', { key: id, style: S.listItem }, `${id} — ${row.kind}${row.format ? ` · ${row.format}` : ''}`)))),
        h('div', { style: S.row({ marginTop: 14, justifyContent: 'flex-end' }) },
          h('button', { style: S.buttonPrimary, disabled: !dirty || busy === 'save', onClick: () => void save() },
            busy === 'save' ? '保存中…' : '保存偏好'))
      ] : []

      // ---------- catalog ----------
      const addCatalog = (entry) => {
        if (!draft) return
        const inputs = catalogInputs[entry.id] || {}
        const source = K.clone(entry.source)
        for (const requirement of entry.requires || []) {
          const value = inputs[requirement.key] ?? requirement.value ?? ''
          if (!value) { setError(`请先填写「${requirement.label}」`); return }
          K.setPath(source, requirement.key, value)
        }
        const targetId = addTarget || draft.topics[0]?.id
        if (!targetId) { setError('请先在「主题」里新建一个主题'); return }
        setError(null)
        edit((cfg) => {
          const topic = cfg.topics.find((row) => row.id === targetId)
          if (!topic) return
          topic.sources = [...(topic.sources || []), source]
        })
        setNote(`已加入「${draft.topics.find((row) => row.id === targetId)?.name || targetId}」，记得点保存。`)
      }

      const catalogView = [
        h('div', { style: S.row({ marginTop: 14 }) },
          h('span', { style: S.sub }, '添加到主题：'),
          h('select', {
            style: S.select, value: addTarget, onChange: (event) => setAddTarget(event.target.value),
          }, (draft?.topics || []).map((topic) => h('option', { key: topic.id, value: topic.id }, topic.name || topic.id))),
          h('span', { style: S.sub }, '标记为「模板」的需要先填地址/正则')),
        ...CATEGORY_GROUPS.map(([category, entries]) => h('div', { key: category, style: S.card },
          h('div', { style: S.title }, category),
          h('div', { style: { ...S.grid(240), marginTop: 10 } },
            entries.map((entry) => h('div', { key: entry.id, style: S.catCard },
              h('div', { style: { fontWeight: 500 } }, entry.name),
              h('div', { style: S.sub }, entry.description),
              ...(entry.requires || []).map((requirement) => h('input', {
                key: requirement.key, style: S.inputWide, placeholder: requirement.label,
                value: catalogInputs[entry.id]?.[requirement.key] ?? requirement.value ?? '',
                onChange: (event) => setCatalogInputs((current) => ({
                  ...current,
                  [entry.id]: { ...(current[entry.id] || {}), [requirement.key]: event.target.value },
                })),
              })),
              h('button', { style: S.button, onClick: () => addCatalog(entry) }, '添加到主题')))))),
      ]

      const body = tab === 'overview' ? overview : tab === 'topics' ? topicsView : tab === 'prefs' ? prefsView : catalogView

      return h('div', { style: S.page },
        h('div', null,
          h('h2', { style: S.h2 }, 'Pushbot'),
          h('div', { style: S.sub }, `${data.root} · 配置 ${data.configPath}`),
          h('div', { style: { ...S.sub, marginTop: 4 } },
            h('span', { style: S.pill(running ? T.ok : T.error) }),
            running ? '服务运行中' : `服务未运行（${service.active || 'unknown'}）`,
            ` · 版本 ${health.version || '?'} · 构建 ${health.build ?? '?'} · 重启 ${service.restarts ?? 0} 次`)),

        !hostReady && h('div', { style: S.banner },
          '面板主机端已更新，但正在运行的 DSH 还加载着旧版本。重启一次 DSH 后即可编辑配置（当前为只读）。'),

        h('div', { style: S.tabs }, tabs.map(([key, label]) =>
          h('button', { key, style: S.tab(tab === key), onClick: () => setTab(key) }, label))),

        h('div', { style: { marginTop: 4 } }, ...body),

        note && h('div', { style: S.note }, note),
        error && h('div', { style: S.error }, error))
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
