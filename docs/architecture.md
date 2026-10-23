# DSH 常驻 · 自改进消息推送服务 · 架构设计 v2（headless）

> 已确认的三个决策：**目录 `~/pushbot`** · **分级自治（低风险自动、高风险人批）** · **纯 headless，不要 Web UI**。
>
> 2026-10-23　·　目标机：Linux（systemd user）　·　DSH `0.2.1-rc.2`

---

## 0. 决策记录

| 决策 | 选择 | 影响 |
|---|---|---|
| 部署位置 | `~/pushbot` | 独立目录、独立 `DSH_HOME`；需要一次 full-access 批准写 `~/.config/systemd/user` 与 `~/pushbot` |
| 自治程度 | 分级 | 低风险改动过门禁自动发布；高风险改动飞书卡片人批 |
| 界面形态 | **纯 headless** | 常驻进程**不含 Web 服务**，用自定义 app bundle（`dsh-base` + 启动插件），健康检查走心跳文件而非 HTTP |

---

## 1. 为什么纯 headless 是可行的（技术依据）

1. **DSH 把进程寿命交给挂载的插件**：`runProfile()` 的原话是"leave process lifetime to the mounted plugins (or to a one-shot runner the composition mounts)"。所以一个只挂 `dsh-base` + 启动插件 + 业务插件的 profile，会一直活着，**不需要 Web 服务来保活**。
2. **`dsh-base` 已经包含业务所需的一切**：`timer`（调度）、`web`/`web-search-deepseek`/`web-fetch-http`（抓取）、`llm`（摘要）、`tools`/`skill`、`storage`、`settings`、`plugin-manager`、`jobs`、`subprocess`、`sandbox`。
3. **创造模式的检查工具不依赖 Web**：`cordisInspect` 服务由 `@deepseek-ai/dsh-cordis-host-runner` 提供，`@deepseek-ai/dsh-tool-cordis` 只注入 `tools` + `cordisInspect`；两者的依赖里都没有 `webServer`。因此 headless profile 也能装上 `cordis_inspect_*`。
4. **dsh-im 的宿主侧对 `webServer` 是可选注入**（`ctx.inject(["webServer"], …)` 只是懒加载分支），没有 Web 服务时那一支不执行，但 `ctx.dshIm.send()` 服务本身可用。

**代价（必须写清楚）**：
- 没有 HTTP，就没有 `/api/dsh-im/delivery/messages` 这条外部推送入口——但我们在进程内直接调 `ctx.dshIm.send()`，反而更短。
- 没有 Web UI，就没有设置页/面板——配置改为**文件 + agent 工具**。
- dsh-im 的**首次渠道接入**（飞书填凭据、微信扫码）本身是交互式的，见 §4.3。

---

## 2. 总体架构

```
┌───────────────── systemd --user（linger，开机即起）──────────────────┐
│                                                                    │
│ ① pushbot.service（常驻，headless）     ② pushbot-improve.timer（每天 03:00）│
│ ┌────────────────────────────┐        ┌──────────────────────────────┐│
│ │ dsh --profile pushbot      │        │ dsh --profile pushbot-improver││
│ │ DSH_HOME=~/pushbot/home    │        │ （一次性，跑完退出）           ││
│ │ bundles: dsh-base          │        │ bundles: dsh-base + headless  ││
│ │        + dsh-pushbot-app   │        │        + cordis-host-runner   ││
│ │        + dsh-im + dsh-watch│        │        + tool-cordis + skills ││
│ │ 无 HTTP、无 UI              │        │ 创造模式：inspect/plugin_manager││
│ │ timer→抓取→去重→摘要→推送   │        │ 观察→归因→提案→实现→验证→发布 ││
│ └───────────┬────────────────┘        └──────────────┬───────────────┘│
│             │ 心跳文件 data/health.json                │ 改代码 / 装版本 / 重启 │
│             ▼ 推送 IM                                  ▼                      │
│        飞书 / 微信                              ~/pushbot/{app,versions,ops}   │
└────────────────────────────────────────────────────────────────────┘
```

三个 profile（全部在 `~/pushbot/home/profiles/` 下）：

| profile | 形态 | 用途 | 生命周期 |
|---|---|---|---|
| `pushbot` | headless 常驻 | 抓取 + 去重 + 推送 | systemd 常驻 |
| `pushbot-improver` | headless 一次性 | 创造模式自我改进 | systemd timer 触发，跑完退出 |
| `pushbot-setup` | **临时** Web（仅 127.0.0.1） | 首次接入 IM 机器人、配置渠道 | 只在你接入渠道时启动，配完即关 |

> `pushbot-dev` 不需要独立 profile：灰度验证用同一份 `pushbot` profile + `PUSHBOT_RUN_ONCE=1 PUSHBOT_DRY_RUN=1` 环境变量跑一轮离线夹具，退出码即结果。

---

## 3. 目录与文件

```
~/pushbot/
├── home/                              # DSH_HOME（完全独立）
│   ├── profiles/pushbot/              # package.json: dsh.profile.bundles
│   ├── profiles/pushbot-improver/
│   ├── profiles/pushbot-setup/
│   ├── skills/                        # 从 dsh 安装目录拷入的创造模式 skills
│   └── sessions/ storages/ logs/
├── app/                               # 插件源码（git，改进器唯一可写工程区）
│   ├── packages/dsh-pushbot-app/      # 自定义 app bundle：启动插件 + 保活
│   ├── packages/dsh-watch/            # 抓取/去重/推送 Host 插件（无 Client 半边）
│   ├── packages/dsh-watch-core/       # 纯逻辑 + 单测 + fixtures
│   └── CHANGELOG.md
├── versions/v001/ v002/ … current ->   # 不可变已发布版本
├── ops/                               # bootstrap（校验和冻结，改进器不可改）
│   ├── systemd/dsh-pushbot.service
│   ├── systemd/dsh-pushbot-improve.{service,timer}
│   ├── systemd/dsh-pushbot-healthcheck.{service,timer}
│   ├── healthcheck.mjs                # 读心跳，过期就 restart
│   ├── promote.mjs                    # 打版本→装→重启→验→回滚
│   ├── improve-prompt.md              # 改进器的任务提示词
│   └── CHECKSUMS
├── config.json                        # 主题/源/推送目标/调度（无 UI，直接编辑）
├── data/
│   ├── watch.db                       # 源/游标/去重/outbox/指标（SQLite WAL）
│   ├── health.json                    # 心跳 + 指标快照
│   ├── reports/2026-10-23.md          # 每日投递记录（可读文件，替代面板）
│   └── backups/
└── proposals/                         # 改进提案与结论
```

---

## 4. 进程层：常驻与自愈（无 HTTP）

### 4.1 服务单元

```ini
# ~/.config/systemd/user/dsh-pushbot.service
[Unit]
Description=DSH pushbot (headless watch & notify)
After=network-online.target

[Service]
Type=simple
Environment=DSH_HOME=%h/pushbot/home
Environment=PUSHBOT_CONFIG=%h/pushbot/config.json
ExecStart=/usr/bin/env dsh --profile pushbot
Restart=always
RestartSec=5
StartLimitIntervalSec=0
MemoryMax=1G
TasksMax=512

[Install]
WantedBy=default.target
```

- 没有 `--port`、没有 `--no-open`——这个 profile 里根本没有 web 行。
- `systemctl --user enable --now dsh-pushbot` + `loginctl enable-linger "$USER"`。

### 4.2 健康检查：心跳文件代替 HTTP

插件每轮抓取/推送后原子写 `data/health.json`：

```json
{ "version": "0.3.1", "pid": 12345, "startedAt": "…",
  "lastCycleAt": "2026-10-23T16:20:00Z", "nextCycleAt": "2026-10-23T16:50:00Z",
  "sources": { "ok": 7, "failing": 1 },
  "outboxPending": 0, "lastDeliveryAt": "…", "rssMb": 84 }
```

`ops/healthcheck.mjs`（systemd timer，每分钟）：
- `now - lastCycleAt > 2.5 × 最大间隔` → `systemctl --user restart dsh-pushbot`；
- `outboxPending > 20` 持续 30 分钟 → 推送一条告警到 IM；
- 重启 3 次仍不健康 → 回滚到 `versions/previous`（调 `promote.mjs rollback`）。

### 4.3 首次接入 IM 渠道（唯一需要交互的一步）

飞书/微信的机器人接入本质上是交互式的（飞书要填 app 凭据、微信要扫码），所以：

1. 临时起 `dsh web --profile pushbot-setup --host 127.0.0.1 --port 3090 --no-open`；
2. 在浏览器（或 SSH 隧道）里完成「设置 → IM 机器人」接入，建投递目标 `feishu-alerts` / `wx-alerts`，各点一次「测试」；
3. 关掉 setup 实例。凭据与目标落在 `~/pushbot/home` 里，常驻的 headless 进程直接复用；
4. 之后永远不需要再开 UI。

> **如果你连这一次都不想要**：v1 的出站可以绕过 dsh-im，直接走 webhook（飞书群机器人 URL / Server酱 token / PushDeer），全部写在 `config.json` 里，零交互、零 UI。代价是失去"收到消息后能回复交互"的双向能力。两条路可以在接口层兼容（`Notifier` 抽象），P2 再决定要不要切。

### 4.4 日志与资源

- 全部走 journald：`journalctl --user -u dsh-pushbot -f`；`SystemMaxUse=200M`。
- `MemoryMax=1G`；心跳里带 RSS，超 800MB 触发一次优雅重启。

---

## 5. 业务层：`dsh-watch` 插件（无 UI 版）

### 5.1 数据流

```
源适配器 → 归一化 → 增量判定 → 打分/过滤 → 摘要(可选 ctx.llm) → outbox → 推送 → confirm
RSS/GitHub/热搜/搜索   Item   游标+指纹    主题阈值                     SQLite   Notifier   记账
```

- **调度**：`ctx.timer.interval`；每主题独立间隔（默认 30 分钟）；启动时补跑错过的窗口。
- **去重**：`topic:source:itemId` + 14 天指纹窗口；先落 outbox 再投递，成功才 confirm。
- **推送**：`Notifier` 抽象，默认实现 `DshImNotifier`（`ctx.dshIm.send`），可选 `WebhookNotifier`。
- **配置**：`~/pushbot/config.json`，示例：

```json
{
  "notifiers": [
    { "id": "feishu-alerts", "kind": "dsh-im", "botId": "bot_…", "targetId": "feishu-alerts" }
  ],
  "topics": [
    { "id": "ai-news", "name": "AI 资讯", "everyMinutes": 30,
      "minScore": 2, "quietHours": ["23:00", "08:00"],
      "sources": [
        { "kind": "rss", "url": "https://…/feed.xml" },
        { "kind": "github", "repo": "deepseek-ai/deepseek-harness", "events": ["release"] },
        { "kind": "search", "query": "DeepSeek 新模型", "engine": "deepseek" }
      ] }
  ],
  "llm": { "enabled": true, "maxCallsPerDay": 20 }
}
```

- **agent 工具**（无 UI 时的操作入口）：`watch_list` / `watch_add` / `watch_remove` / `watch_run` / `watch_test_push` / `watch_stats`。
- **可读报告**：每日 `data/reports/YYYY-MM-DD.md`（推了什么、哪些源失败、为什么没推），替代侧边栏面板。

### 5.2 为什么抓取绝不能跑在 agent 会话里

| | 插件 timer | 定时 agent 会话 |
|---|---|---|
| 每次成本 | ≈0 token（仅摘要时调 LLM） | 整轮会话 |
| 确定性 | 高 | 低 |
| 延迟 | 秒级 | 数十秒~分钟 |
| 可观测 | 指标/心跳 | 只能翻会话 |

结论：常规链路 100% 代码；agent 只出现在摘要（一次 `ctx.llm`）和改进器两处。

---

## 6. 改进层：创造模式自改进（headless）

### 6.1 改进器 profile 的组成

`pushbot-improver` = `dsh-base` + `dsh-headless`（一次性跑完退出）+ 补三行：

```yaml
- insert:
    - id: cordis-host-runner
      name: '@deepseek-ai/dsh-cordis-host-runner'      # 提供 cordisInspect 服务
    - id: cordis-inspect-providers
      name: '@deepseek-ai/dsh-tool-cordis/host'        # Host 侧 inspect provider
    - id: tool-cordis
      name: '@deepseek-ai/dsh-tool-cordis'             # cordis_inspect_list/query
    - id: skill-filesystem
      config:
        customSkillDirs: [ '/home/…/pushbot/home/skills' ]  # 创造模式四个 skill
```

启动方式：

```bash
DSH_HOME=~/pushbot/home dsh --profile pushbot-improver "$(cat ~/pushbot/ops/improve-prompt.md)"
```

这样一次运行里，agent 拿到的是：`cordis_inspect_*`（查真实 API）、`plugin_manager`（装 bundle）、fs/bash（改代码跑测试）、四个创造模式 skill（插件开发/组合编辑规范）、`web`（查资料）、`subagent`（并行评审）。

> **降级预案**：若 `cordis-host-runner` 在 headless 组合下缺依赖而装不起来，改进器仍可用 fs + bash + skill 工作——`cordis-plugin-development` skill 明确允许"包 README → `lib/types/*.d.ts` → 源码"三级知识来源，检查工具只是第一优先，不是唯一路径。

### 6.2 一次自改进的闭环

```
①观察  读 data/watch.db 指标 + health.json + journald + CC 反馈
②归因  写假设与预期指标（例：V2EX 解析失败 42 次/天 → 成功率 58%→>95%）
③提案  proposals/00N-*.md（现状/证据/假设/改动面/风险/回滚点/验收）
        高风险 → 飞书卡片请求人批
④实现  app/ 独立 git 分支；补 fixtures；node --test 全绿
⑤验证  PUSHBOT_RUN_ONCE=1 PUSHBOT_DRY_RUN=1 跑 pushbot profile：离线夹具一轮 + 测试推送
⑥发布  ops/promote.mjs：打 vNNN → 装到 pushbot profile → restart → 60s 内健康
⑦回滚  健康失败/启动失败 3 次 → 装回 previous → restart → 推告警
⑧记账  CHANGELOG + 提案结论 + Hindsight 知识页 + 前后 7 天指标对比
```

### 6.3 机械门禁（代码检查，不是模型自觉）

| 门禁 | 规则 |
|---|---|
| 路径白名单 | 只写 `~/pushbot/app`、`data`、`proposals`；拒绝 `~/pushbot/ops`、`home/profiles`、`~/.dsh` 及白名单外路径 |
| bootstrap 冻结 | `ops/` 校验和必须匹配 `CHECKSUMS`，否则拒绝发布并告警（改进器不能改自己的刹车） |
| 变更规模 | 单次 ≤400 行 diff、≤3 个文件；新增运行时依赖需人批 |
| 测试 | 必须附 fixtures/单测，`node --test` 全绿 |
| 干跑 | 离线夹具一轮 + 一次真实测试推送必须成功 |
| 频率 | 自动发布 ≤1 次/天；同一文件 7 天内最多改 2 次 |
| 数据库 | schema 迁移可回滚；发布前自动备份 `data/backups/` |
| 预算 | 单次运行 token 上限；超限中止，提案留到次日 |

### 6.4 审批矩阵

| 变动 | 处理 |
|---|---|
| 修解析器、加源、调阈值、修 bug、改文案 | **自动**（过门禁即发） |
| 改推送目标/加渠道、扩权限、间隔 <15 分钟、加依赖、改 DB schema | **人批**（飞书文本确认 → 回写 `data/approvals/NNN.json`） |
| 改 `ops/` bootstrap、改门禁/审批逻辑、写 `~/.dsh`、白名单外路径 | **硬拒绝** |

### 6.5 触发

- 定时：`dsh-pushbot-improve.timer` 每天 03:00；
- 异常：源成功率骤降、投递连续失败、服务异常重启；
- 用户反馈：你在 IM 里说"太吵了/也想要小红书"，落成提案草稿；
- 手动：直接找主 DSH agent 说"让 pushbot 改进 X"。

---

## 7. 风险与控制

| 风险 | 控制 |
|---|---|
| 自改代码把服务改挂 | 蓝绿发布 + 心跳健康 + 3 次失败自动回滚 + 回滚告警 |
| 改进器改掉回滚逻辑 | `ops/` 校验和冻结 + 无写权限 |
| 无 HTTP 导致"假活" | 心跳文件 + 外部 timer 检查 + 过期重启 |
| 内存/日志膨胀 | `MemoryMax=1G` + RSS 阈值重启 + journald 上限 |
| 独立 DSH_HOME 凭据要重配 | P0 一次性配置；文档留档 |
| dsh-im 首次接入要 UI | 一次性 setup 实例；或改走 webhook 零交互 |
| 微信 iLink 风控 | 飞书为主，微信为辅 |
| DSH 升级破坏插件 | 升级前在 dry-run profile 验证 + `--dump-config` 门禁 |
| GitHub 限流 | `gh` 认证额度 5000/h + ETag |

---

## 8. 阶段计划（按你的决策调整）

| 阶段 | 内容 | 验收 | 预估 |
|---|---|---|---|
| **P0** | `~/pushbot` + 独立 `DSH_HOME` + `pushbot`/`setup` profile + systemd + 飞书接入 + 一条推送 | 重启机器自起；飞书收到测试消息；**进程无监听端口**（`ss -lntp` 验证） | 0.5 天 |
| **P1** | `dsh-watch` v0.1：RSS + GitHub、去重、outbox、心跳、`config.json`、报告文件 | 连续 24h 无重复/漏推；kill -9 后 5 秒自愈；心跳过期 2.5× 触发重启 | 1.5 天 |
| **P2** | `versions/` + `promote.mjs` + dry-run 验证 + 回滚演练 | 手动发布 v002 并成功回滚一次 | 1 天 |
| **P3** | `pushbot-improver`（headless 创造模式）+ 提案/门禁/审批 + timer | 改进器自主修好一个真实解析器故障，全程可审计 | 2 天 |
| **P4** | 热搜/关键词源 + 每日报告 + 指标对比 | 四类源上线，误报率 <5% | 1–2 天 |

---

## 9. 与市场现成件的取舍

| 件 | 用不用 | 理由 |
|---|---|---|
| `@chenkai114/dsh-daemon` | 不用（参考） | 它管的是 `dsh web`（有 HTTP），与纯 headless 冲突；systemd unit 只有 20 行，自己写更可控 |
| `dsh-continual-evolve` | 不用（借思想） | 它进化记忆/技能，不进化代码；"模型提议、代码门禁、快照可回滚、默认试运行"这套治理直接搬 |
| `dsh-im` | 用 | 唯一同时覆盖飞书+微信且提供进程内 `send()` 的通道 |
| `dsh-rss` | 不装（参考） | 抄它的游标增量抓取实现，不引入它的 UI 半边 |
| `dsh-rss-daily` | 不装（参考） | 抄它的幂等投递/去重窗口/主编式摘要 |

---

## 10. P0 交付记录（2026-10-23）

已按"零交互 webhook 版"完成 P0，代码在 `~/pushbot`：

| 交付项 | 状态 | 证据 |
|---|---|---|
| 独立 `DSH_HOME` + headless profile | ✅ | `dsh --profile pushbot --dump-config` 组合出 `pushbot-watch` 行 |
| 自定义 app bundle（base + 启动插件，无 HTTP） | ✅ | 进程运行期间 `ss -lntp` 无该 PID 的监听端口 |
| RSS + GitHub 抓取 | ✅ | 一轮抓到 HNRSS 5 条 + GitHub releases 3 条 |
| 去重游标 | ✅ | `data/state.json` 记录 `seen` 与 `lastRunAt`，第二轮 `nothing new` |
| webhook 出站 | ✅ | 本地 receiver 收到 `POST /hook` 与完整摘要 JSON |
| 心跳健康 | ✅ | `data/health.json` 每轮更新，含 `phase/rssMb/lastCycleAt/sources` |
| systemd unit + 健康 watchdog + cron 兜底 | ✅ 已写 | `ops/dsh-pushbot.service`、`ops/healthcheck.mjs`、`ops/ensure.sh` |

**过程中发现并修复的 bug**：`stripTags()` 先剥 HTML 标签、后处理 CDATA，导致 `<![CDATA[...]]>` 标题被整段吞掉、RSS 条目全部被丢弃。已改为先提取 CDATA 内容再剥标签。

**环境限制（重要）**：当前 agent shell 运行在 bwrap 沙箱内（PID 1 是 `bwrap`），`systemctl --user` 无法连接用户管理器、`crontab` 被拒。因此：
- 服务代码已在沙箱内跑通验证（含常驻模式与自愈所需的心跳）；
- **真正的开机自启需要在普通登录终端执行** `bash ~/pushbot/ops/install-service.sh`；
- 沙箱内启动的进程会随沙箱销毁，不能当作常驻服务。

## 11. 下一步

1. 你在普通终端跑 `bash ~/pushbot/ops/install-service.sh`，确认 `systemctl --user status dsh-pushbot` 为 active。
2. 把 `~/pushbot/config.json` 里 `notifiers.feishu.url` 换成你的飞书群机器人 webhook，并把哪个主题的 `notifier` 改成 `"feishu"`。
3. 进入 P1：更多源（热搜/关键词搜索/网页选择器）、outbox 重试、`ctx.llm` 摘要、日报聚合。

## 12. CI/CD（P2 提前完成，2026-10-23）

原计划放在 P2 的版本化发布被提前，因为它是 P3 自改进的前置门禁。

**CI**：`ops/ci.sh` = 语法检查（core/index/healthcheck/ensure/promote）+ `node --test`（6 个用例，夹具覆盖 CDATA 回归、RSS/Atom、免打扰跨午夜、digest 截断）。`.git/hooks/pre-commit` 自动执行，CI 不过提交失败。

**CD**：`ops/build.sh` 生成不可变 `versions/vNNN/`（包副本 + `manifest.json`：构建号、semver、git sha、sha256）；`ops/promote.mjs` 校验 sha256 → 原子切换 `versions/current` → 重启 → 等心跳（默认 60s）→ 失败自动回滚；`data/deploys.json` 留全部发布/回滚记录；心跳的 `build` 字段即当前生效版本。

**实测证据**：v001→v002 正常发布；`promote rollback` 回到 v001；故意注入启动异常的 v004 在 15s 后被判定失败并自动回滚到 v001。

**演练暴露的三个真问题（已修）**：
1. DSH 在插件 `apply()` 抛错时**不退出进程**，只打印 "1 entry did not activate" 继续跑基座 → 坏版本 = 活着但不干活的僵尸。健康门禁必须看心跳，不能看进程存活。
2. 回滚时按 `health.json` 里的 pid 去杀是错的——坏进程从没写过心跳，pid 是上一代留下的。改为按命令行精确匹配所有在跑的实例（`^[^ ]*node .*lib/bin\.js --profile pushbot$`），先 SIGTERM 再 SIGKILL。
3. `pgrep -f "lib/bin.js --profile pushbot"` 这种宽松模式会匹配到任何命令行里含该字符串的进程（包括测试脚本自己的 shell），必须锚定。

`ops/ensure.sh`（cron/systemd 不可用时的兜底 supervisor）同样改为"先判心跳新鲜度，再决定是否杀掉重启"，而不是只看进程是否存在。

## 13. P1 + P3 交付记录（2026-10-23）

### P1：抓取能力、可靠性与日报

| 交付项 | 实现 | 验证 |
|---|---|---|
| 6 类源 | `lib/sources.js`：`rss/atom`、`github`、`hackernews`、`hn-search`、`v2ex`、`page` | 端到端一轮抓到 9 条（HN 热榜 3 + 关键词 3 + 网页断言 1 + RSS 2），`sources.ok=4 failing=0` |
| 网页变更监控 | `page` 源：区域正则 + 归一化 + 哈希；`expect.contains/absent` 断言模式 | 页面返回"已售罄"，`expect.contains:"现货"` 正确产出"断言不满足"告警 |
| 关键词过滤 | `filter.includeAny` / `excludeAny` | 单测覆盖，端到端 `excludeAny:["hiring"]` 生效 |
| 投递可靠性 | `lib/outbox.js`：先入队再发、指数退避 1→30 分钟、8 次后进死信 | 端到端 `attempts` 1→2；死信路径由单测覆盖 |
| 可选 LLM 摘要 | `summarize()` 直连 OpenAI 兼容端点，日熔断 `maxCallsPerDay` | 无 key 时自动降级为规则摘要（端到端验证，`llmCalls={}` 且照常推送） |
| 每日日报 | `data/reports/YYYY-MM-DD.md` + 定时摘要推送 | 端到端生成日报，含每主题分组与统计 |
| 心跳扩展 | `outboxPending` / `outboxDead` / `deliveryFailures` / `build` | 端到端 `health.json` 全部字段正确 |

### P3：创造模式自改进

| 交付项 | 实现 | 验证 |
|---|---|---|
| 独立改进器 profile | `home/profiles/pushbot-improver`：`dsh-base` + `dsh-headless` + `cordis-host-runner` + `tool-cordis` + 创造模式 skills | `--dump-config` 确认三行挂载；无 key 启动时给出 `MISSING_CREDENTIAL` 而非崩溃 |
| bootstrap 冻结 | `ops/freeze.mjs` + `ops/CHECKSUMS`（22 个文件） | 改动 `ops/gate.mjs` 后门禁报 `freeze=false` 并拒绝 |
| 机械门禁 | `ops/lib/gate-rules.mjs`（纯函数）+ `ops/gate.mjs`（收集 git/CI/冻结/历史） | 5 场景矩阵：code→`pass`、docs→`approval`、ops→`blocked`、密钥→`blocked`、未提交→`blocked` |
| 人批流程 | `ops/approve.mjs`：request/list/approve/reject，经 IM 推请求 | 实测创建→列出→批准→状态查询全链路 |
| 编排 | `ops/improve.sh`：冻结校验 → 跑改进器 → 门禁 → 自动发布/转人批/拒绝 → 记账 | 4 分支演练：auto-deploy（stub build+promote 被调用）、approval（生成 pending 请求）、blocked、no-op |
| 定时 | `dsh-pushbot-improve.{service,timer}`，每天 03:00，`Persistent=true` | unit 已写入并在 `install-service.sh` 中按有无 `improve.env` 条件启用 |
| 可测试性 | `PUSHBOT_IMPROVE_DRY_RUN=1`、`PUSHBOT_IMPROVE_CMD` | 两条路径都实测通过 |

### 本轮修掉的 5 个真实缺陷

1. **churn 时间窗比较写反**（`now - at < recentWindow` 而不是 `at > recentWindow`），把 30 天前的历史也算进 7 天窗口，导致所有改动都被要求人批。
2. **manifest 只哈希两个文件**，新增的 `outbox.js`/`sources.js` 不在完整性校验里 → 改为遍历 `lib/` 全量哈希。
3. **健康门禁接受 `phase:"starting"`**，坏版本启动瞬间也能通过 → 改为只认 `ok`/`idle`。
4. **人批推送不校验 HTTP 状态**，占位 URL 也报"已推送" → 改为检查 `response.ok`。
5. **`pkill -f` 模式过宽**会匹配到执行脚本自己的 shell（本轮又复现一次）→ 全仓库改用锚定模式 `^[^ ]*node .*lib/bin\.js --profile pushbot$`。

### 仍然存在的限制

- 自动改进目前只能改 `app/packages/dsh-pushbot-app/`；改 `ops/`、`config.json` 会被硬拒绝。
  这是有意的：门禁代码不能自我修改。
- 改进器的效果依赖隔离 `DSH_HOME` 里的凭据；未配置 `home/improve.env` 时定时器不会启用。
- 沙箱内无法安装 systemd 单元，常驻与夜间定时仍需用户在普通终端执行一次 `install-service.sh`。
