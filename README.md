# dsh-pushbot — 常驻 · headless · 自改进消息推送服务

基于 DeepSeek Harness 的常驻服务：定时从网上抓取你关心的内容，去重、可选摘要后推送到飞书/微信。
**纯 headless**：进程内没有 HTTP 服务、没有 Web UI，靠心跳文件与外部 watchdog 自愈。
**自改进**：每天夜里可以用 DSH 的创造模式（cordis preset）读自己的指标、改自己的代码，
但必须过一个不依赖模型自觉的机械门禁，低风险自动发布，高风险等人批准。

```
~/pushbot/
├── home/                       # 独立 DSH_HOME（profiles / sessions / storages / logs / skills）
│   ├── profiles/pushbot/            # 常驻服务 profile（headless）
│   ├── profiles/pushbot-improver/   # 自改进器 profile（headless + 创造模式）
│   ├── skills/                      # 从 dsh 拷贝的创造模式 skills
│   └── improve.env                  # 改进器凭据（chmod 600，不进 git）
├── app/packages/dsh-pushbot-app/    # 服务插件源码（唯一会被自动修改的地方）
│   ├── lib/core.js                  # 纯逻辑（可单测）
│   ├── lib/sources.js               # 抓取源适配器
│   ├── lib/outbox.js                # 投递队列（重试/退避/死信）
│   ├── lib/index.js                 # 编排（timer/去重/摘要/推送/心跳）
│   └── test/                        # 单测 + fixtures
├── config.json                 # 运行时配置（不进 git）
├── config.example.json         # 配置样例
├── data/                       # state / outbox / health / reports / approvals / improvements
├── ops/                        # 刹车与运维（CHECKSUMS 冻结，改进器改不了）
├── proposals/                  # 改进提案
└── versions/vNNN + current     # 不可变发布版本
```

## 0. 当前部署状态（本机已配好）

| 组件 | 状态 |
|---|---|
| `dsh-pushbot.service` | enabled + active，开机自启，`Restart=always`，`MemoryMax=1G` |
| `dsh-pushbot-healthcheck.timer` | 每分钟检查心跳，过期/报错/RSS 超限自动重启（带 2 分钟启动宽限） |
| `dsh-pushbot-improve.timer` | 每天 03:00 跑一次自改进，门禁不过不发布 |
| 推送通道 | **飞书应用直连**（复用你在 DSH 里已接入的智能体），`format=markdown` 走卡片 |
| 凭据 | `home/feishu.env`（0600，不提交）、`home/improve.env`（0600，不提交） |

常用命令：

```bash
systemctl --user status dsh-pushbot          # 服务状态
journalctl --user -u dsh-pushbot -f          # 实时日志
cat ~/pushbot/data/health.json               # 心跳/指标
systemctl --user list-timers 'dsh-pushbot*'  # 两个定时器
bash ~/pushbot/ops/run-once.sh               # 立刻跑一轮
```

## 0.0 飞书通道（三种，已启用第一种）

| 方案 | 出口 | 依赖 | 适用 |
|---|---|---|---|
| **A. 飞书应用直连（已启用）** | 服务自己调飞书 Open API，发到你的智能体私聊 | 只需应用凭据 | 最独立：主 DSH 关掉也能推 |
| B. dsh-im 主动投递 | 主 DSH 的 `/api/dsh-im/delivery/messages` | 主 DSH 必须运行 | 想复用现有连接、不想再管凭据 |
| C. 群自定义机器人 | 飞书 webhook | 无 | 群内共享、多人都要看 |

### A. 应用直连（一条命令）

```bash
node ops/set-feishu-app.mjs            # 自动发现机器人 + 读凭据 + 发测试 + 写配置
node ops/set-feishu-app.mjs --format plain   # 想用纯文本而不是卡片
```

它做四件事：从 `~/.dsh/integrations` 找已接入的飞书智能体 → 从 `~/.dsh/.credentials.yaml`
取应用密钥 → 往你的私聊发一条测试消息 → 写 `home/feishu.env`(0600) 和 `config.json`。

服务通过 systemd `EnvironmentFile` 读密钥，所以密钥不落在 `config.json` 里。

### B. 走主 DSH 的 dsh-im

```bash
node ops/set-im.mjs --target <targetId>    # targetId 在 设置 → IM机器人 → 复制调用参数
```

### C. 群自定义机器人

```bash
node ops/set-feishu.mjs 'https://open.feishu.cn/open-apis/bot/v2/hook/你的地址'
```

常见报错：`code=19021` → 加 `--secret`；提到「关键词」→ 安全设置加关键词「新内容」。

## 0.0.1 关闭 / 调整

```bash
systemctl --user disable --now dsh-pushbot-improve.timer   # 暂停夜间自改进
systemctl --user disable --now dsh-pushbot                 # 暂停推送服务
bash ops/uninstall-service.sh                              # 彻底卸载（保留数据）
```

## 0.1 仓库与开发

- 架构与设计决策：[`docs/architecture.md`](docs/architecture.md)
- 本地 CI：`bash ops/ci.sh`（53 个用例，无需网络）
- 安装 git 钩子（提交前自动跑 CI）：`bash ops/install-hooks.sh`
- 断点与刹车都在 `ops/`，由 `ops/CHECKSUMS` 冻结；改动 `ops/` 会让自改进门禁拒绝发布
- 服务插件源码在 `app/packages/dsh-pushbot-app/`，只有这里会被夜间自改进修改

## 1. 抓取源

| kind | 说明 | 关键参数 |
|---|---|---|
| `rss` / `atom` | 标准订阅源，CDATA/实体/Atom 的 `href` 都能解析 | `url`、`limit` |
| `github` | release 或 commit | `repo`、`events:["release","commit"]`、`limit`（`GITHUB_TOKEN` 有则自动带上，额度 5000/h） |
| `hackernews` | HN 首页热榜（官方 Firebase API） | `limit` |
| `hn-search` | HN 关键词搜索，按时间倒序 | `query`、`sinceDays`、`limit` |
| `v2ex` | V2EX 热帖 | `limit`、可选 `endpoint` |
| `page` | 网页变更监控 / 断言监控 | `url`、可选 `region` 正则、`expect.contains` / `expect.absent` |

`page` 两种用法：

```json
{ "kind": "page", "url": "https://shop/item", "name": "商品页",
  "region": "<main[\\s\\S]*?</main>",
  "expect": { "contains": "现货", "absent": "缺货" } }
```

- 只给 `url`：内容哈希变化时推送一次（首次抓取只记录基线，不推）。
- 给 `expect`：每次检查断言，不满足就推送（例如"现货"消失、"缺货"出现），同一状态只提醒一次。

## 2. 配置 `config.json`

```json
{
  "notifiers": {
    "feishu": { "kind": "feishu-webhook", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx" },
    "file":   { "kind": "file", "path": "data/notifications.log" }
  },
  "llm": { "enabled": false, "apiKeyEnv": "PUSHBOT_LLM_API_KEY", "baseUrl": "https://api.deepseek.com",
           "model": "deepseek-chat", "maxCallsPerDay": 20 },
  "dailyReport": { "at": "09:00", "notifier": "feishu" },
  "topics": [
    { "id": "ai-news", "name": "AI 资讯", "everyMinutes": 30, "notifier": "feishu",
      "maxItemsPerPush": 6, "maxItemsPerRun": 20,
      "quietHours": ["23:30", "07:30"],
      "filter": { "includeAny": [], "excludeAny": ["招聘", "实习"] },
      "sources": [
        { "kind": "rss", "url": "https://hnrss.org/frontpage", "limit": 5 },
        { "kind": "hackernews", "limit": 5, "name": "HN" },
        { "kind": "hn-search", "query": "deepseek", "limit": 5, "sinceDays": 3, "name": "HN搜索" }
      ] }
  ]
}
```

- `filter.includeAny` / `excludeAny`：命中标题或摘要的关键词，大小写不敏感。
- `llm.enabled`：开启后每轮把新条目交给模型写成手机能读的简报；**没配 key 或调用失败会自动降级**为规则摘要，不会漏推。日调用上限由 `maxCallsPerDay` 熔断。
- `dailyReport`：每天该时刻生成 `data/reports/YYYY-MM-DD.md`，并推一份摘要。
- 改完不用重启：每轮都会重新读取。

## 3. 可靠性

- **先入队再投递**：每份摘要写入 `data/outbox.json` 后才发送；发送成功才移除。
- **失败重试**：指数退避 1→2→4→…→30 分钟，最多 8 次；超过后进 `dead` 队列保留现场。
- **去重**：每个主题保存已见条目 id（最多 1000 条），跨源同一内容不会重复推。
- **源隔离**：单个源失败只影响自己，计入 `health.json` 的 `sources.failing`。
- **心跳**：`data/health.json` 每轮刷新，外部 watchdog 读它判断"活着但没干活"的僵尸进程。

## 4. 运行

手动跑一轮（不常驻）：

```bash
cd ~/pushbot
DSH_HOME=$HOME/pushbot/home PUSHBOT_ROOT=$HOME/pushbot PUSHBOT_RUN_ONCE=1 \
  dsh --profile pushbot
cat data/health.json data/notifications.log data/reports/*.md
```

装成常驻服务（**必须在普通登录终端执行**，DSH 沙箱内看不到 systemd 用户管理器）：

```bash
bash ~/pushbot/ops/install-service.sh
systemctl --user status dsh-pushbot
journalctl --user -u dsh-pushbot -f
```

它会装三个东西：`dsh-pushbot.service`（`Restart=always`）、
`dsh-pushbot-healthcheck.timer`（每分钟查心跳）、
`dsh-pushbot-improve.timer`（每天 03:00 自改进，只有存在 `home/improve.env` 时才启用）。

没有 systemd 时用 cron 兜底：

```bash
crontab -e
@reboot      /home/oyx/pushbot/ops/ensure.sh
*/5 * * * *  /home/oyx/pushbot/ops/ensure.sh
```

## 5. CI / CD

**CI**（无网络依赖，约 3 秒，49 个用例）

```bash
bash ~/pushbot/ops/ci.sh
```

- 服务插件单测：35 个（解析、去重、过滤、退避、网页归一化、各源适配器、断言监控）
- 门禁规则单测：14 个（越权、超量、CI 失败、冻结漂移、密钥、频率、churn）
- `git commit` 经 `.git/hooks/pre-commit` 自动跑；不过就提交失败

**CD**

```bash
bash ~/pushbot/ops/build.sh              # CI + versions/vNNN（manifest + 全量 sha256）
node ~/pushbot/ops/promote.mjs           # 部署最新构建
node ~/pushbot/ops/promote.mjs v004      # 部署指定构建
node ~/pushbot/ops/promote.mjs rollback  # 回滚
```

校验 sha256 → 原子切换 `versions/current` → 重启 → 60 秒内必须进入 `ok`/`idle` 心跳 → 失败自动回滚。
`data/deploys.json` 留全部发布记录；心跳里的 `build` 字段是当前生效版本。

## 6. 自改进（每天 03:00，或手动）

```bash
bash ~/pushbot/ops/improve.sh
```

流程：

1. `ops/freeze.mjs --verify`：`ops/` 下 22 个 bootstrap 文件校验和必须一致（改进器不能改自己的刹车）
2. 用 `pushbot-improver` profile 跑一次 headless 创造模式 agent（`cordis_inspect_*` + `plugin_manager`
   + 四个创造模式 skill），让它读指标、写提案、改 `app/`、补测试、跑 CI、提交
3. `ops/gate.mjs` 做机械判定：

| 判定 | 条件 | 动作 |
|---|---|---|
| `pass` | 只改 `app/packages/`，≤3 文件、≤400 行，CI 绿，冻结完好，当日额度未用 | 自动 build + promote |
| `approval` | 改了文档、或同一文件 7 天内已改 2 次 | 生成人批请求并推送 |
| `blocked` | 越权路径、超量、CI 失败、冻结漂移、diff 里有密钥、有未提交改动、当日已自动发布过 | 不发布 |

4. 结果写入 `data/improvements.json`（门禁的频率与 churn 判断依赖它），patch 存档在 `data/improvements/`

人批：

```bash
node ops/approve.mjs list
node ops/approve.mjs approve <id> --by 你的名字
node ops/approve.mjs reject <id> --note "理由"
```

凭据：改进器跑在独立 `DSH_HOME`，需要自己的 key：

```bash
cp ops/improve.env.example home/improve.env
chmod 600 home/improve.env     # 填 DEEPSEEK_API_KEY
```

演练（不需要 key，也不会重启真实服务）：

```bash
# 只走到门禁，不跑模型
PUSHBOT_IMPROVE_DRY_RUN=1 bash ops/improve.sh

# 用自定义命令模拟改进器（可测 pass / approval / blocked / no-op 四条分支）
PUSHBOT_IMPROVE_CMD='printf "\n// x\n" >> app/packages/dsh-pushbot-app/lib/core.js && git commit -qam "improve: drill"' \
  bash ops/improve.sh
```

## 7. 诊断

| 现象 | 查什么 |
|---|---|
| 没收到推送 | `data/health.json` 的 `phase`/`sources`/`outboxPending`；`data/outbox.json` 的 `lastError` |
| 一直重启 | `health.json` 的 `error` 字段；多半是 `config.json` 语法或网络 |
| 源持续失败 | `sources.failing`，`journalctl --user -u dsh-pushbot` 里的 `source failed ... kind=...` |
| 重复推送 | `data/state.json` 里该主题的 `seen` 是否被清空 |
| 改进没生效 | `data/improve.log` 的 gate verdict；`data/improvements.json` 的 `reasons` |
| 想临时关门禁外的东西 | 直接看 `ops/gate.mjs --diff-base <ref> --json` 的 `reasons` |

## 8. 阶段状态

- **P0** ✅ 独立 DSH_HOME、headless 常驻、心跳自愈、webhook 推送
- **P1** ✅ 6 类抓取源、关键词过滤、outbox 重试、可选 LLM 摘要、每日日报
- **P2** ✅ 版本化发布、原子换链、健康门禁、自动回滚、CI 49 用例
- **P3** ✅ 创造模式自改进器、bootstrap 冻结、机械门禁、人批流程、夜间定时
- **P4**（未做）更多源（微博/小红书）、摘要质量评估、跨机器迁移
