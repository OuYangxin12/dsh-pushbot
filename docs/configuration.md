# 配置参考

[返回 README](../README.md)

配置文件为 `config.json`（由 `config.example.json` 复制修改，不进 git）。
**每轮重新读取，改完不需要重启。**

## 顶层结构

```json
{
  "notifiers": { "<名字>": { "kind": "...", ... } },
  "llm": { "enabled": false, ... },
  "dailyReport": { "at": "09:00", "notifier": "<名字>" },
  "topics": [ { ... } ]
}
```

## notifiers

通知器字典，`topics[].notifier` 引用其名字。

| kind | 字段 | 说明 |
|---|---|---|
| `feishu-app` | `appId`、`appSecretEnv`、`openId`、`format` | 飞书应用直连，`format` 为 `markdown`（卡片）或 `plain` |
| `dsh-im` | `baseUrl`、`botId`、`targetId`、`format` | 经主 DSH 的 IM 机器人投递 |
| `feishu-webhook` | `url`、`secret?` | 群自定义机器人；开了签名校验必须给 `secret` |
| `webhook` | `url`、`headers?`、`body?` | 任意 JSON webhook |
| `file` | `path` | 追加写本地文件，调试用 |
| `console` | — | 只打日志 |

配置方式见 [channels.md](channels.md)。

## topics

一个主题 = 一组源 + 调度 + 通知器。

| 字段 | 默认 | 说明 |
|---|---|---|
| `id` | — | 唯一标识，去重游标按它存 |
| `name` | `id` | 推送标题里的名字 |
| `everyMinutes` | `30` | 轮询间隔 |
| `notifier` | `console` | 通知器名字 |
| `maxItemsPerRun` | `20` | 每轮最多取多少条进入摘要 |
| `maxItemsPerPush` | `8` | 摘要里最多列多少条 |
| `quietHours` | — | `["23:30","07:30"]`，跨午夜也可以 |
| `filter.includeAny` | — | 命中标题或摘要任一关键词才推（一组 OR） |
| `filter.includeAll` | — | **多组关键词必须全部命中**，组内是 OR，例如 `[[AI 词], [价格词]]` |
| `filter.excludeAny` | — | 命中任一关键词就丢弃 |
| `sources` | — | 见下表 |

## sources

| kind | 关键参数 | 说明 |
|---|---|---|
| `rss` / `atom` | `url`、`limit` | 解析 CDATA、HTML 实体、Atom 的 `href` 与 `updated` |
| `github` | `repo`、`events`、`limit` | `events` 取 `release` / `commit`；有 `GITHUB_TOKEN` 自动带上（5000/h） |
| `hackernews` | `limit` | HN 首页热榜，官方 Firebase API |
| `hn-search` | `query`、`sinceDays`、`limit` | HN 关键词搜索，按时间倒序 |
| `v2ex` | `limit`、`endpoint?` | V2EX 热帖 |
| `github-search` | `query`、`sinceDays`、`sort`、`limit` | GitHub 仓库搜索，`{since}` 会替换成 N 天前的日期（做"最近热门"用） |
| `page` | `url`、`region?`、`expect?` | 网页变更或断言监控 |
| `html-list` | `url`、`item`、`title`、`link?`、`summary?`、`limit` | **任意网页列表**：用正则切块再提字段，无需写代码 |
| `json-api` | `url`、`itemsPath`、`titlePath`、`urlPath`、`idPath?`、`datePath?`、`summaryPath?`、`limit` | **任意 JSON 接口**：点号路径映射字段 |

### 通用源怎么配

`html-list` 用三段正则：`item` 切出条目块，`title` / `link` 在块内提取（第一个捕获组生效）。

```json
{ "kind": "html-list", "url": "https://example.com/news",
  "item": "<li>([\\s\\S]*?)</li>",
  "title": "<h2>([\\s\\S]*?)</h2>",
  "link": "href=\"([^\"]+)\"", "limit": 10 }
```

`json-api` 用点号路径，数组下标也可以（`data.list.0.title`）：

```json
{ "kind": "json-api", "url": "https://api.example.com/items",
  "itemsPath": "data.list", "titlePath": "title", "urlPath": "link",
  "idPath": "id", "datePath": "created", "limit": 10 }
```

### page 的两种用法

```json
{ "kind": "page", "url": "https://shop/item", "name": "商品页",
  "region": "<main[\\s\\S]*?</main>",
  "expect": { "contains": "现货", "absent": "缺货" } }
```

- 只给 `url`：内容哈希变化时推一次；**首次只记基线，不推**。
- 给 `expect`：每次检查断言，不满足就推（例如「现货」消失、「缺货」出现），同一状态只提醒一次。

所有源都支持：

| 字段 | 作用 |
|---|---|
| `name` | 摘要里的 `[标签]` |
| `bypassFilter` | `true` 时该源不受 `filter` 约束；网页变更监控必须开，否则"内容有变化"会被关键词过滤掉 |

## llm（可选）

开启后每轮把新条目交给模型改写成手机可读的简报。

```json
"llm": { "enabled": true, "apiKeyEnv": "PUSHBOT_LLM_API_KEY",
         "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat",
         "maxCallsPerDay": 20 }
```

- 没有 key、调用失败或超日限额 → 自动降级为规则摘要，不会漏推
- `maxCallsPerDay` 是熔断阈值，按本地日期计数

## dailyReport（可选）

```json
"dailyReport": { "at": "09:00", "notifier": "feishu-app" }
```

每天该时刻生成 `data/reports/YYYY-MM-DD.md`，并把摘要推一份。

## automation（可选）

```json
"automation": { "improve": "auto" }
```

| 值 | 含义 |
|---|---|
| `auto`（默认） | 门禁通过就自动发布 |
| `approval` | 永不自动发布，一律转人批 |
| `off` | 夜间不跑自改进 |

冻结校验与机械门禁始终生效，这个开关只决定"通过门禁之后"是否自动上线。

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `PUSHBOT_ROOT` | `~/pushbot` | 数据根目录 |
| `PUSHBOT_CONFIG` | `$PUSHBOT_ROOT/config.json` | 配置文件路径 |
| `PUSHBOT_TICK_MS` | `30000` | 调度心跳间隔 |
| `PUSHBOT_RUN_ONCE` | — | `1` 时跑一轮即退出 |
| `PUSHBOT_FETCH_TIMEOUT_MS` | `20000` | 单次抓取超时 |
| `PUSHBOT_FETCH_RETRIES` | `2` | **GET** 失败重试次数（POST 不重试，避免重复投递） |
| `PUSHBOT_RETRY_DELAY_MS` | `500` | 重试线性退避基数 |
| `FEISHU_APP_SECRET` | — | `feishu-app` 通道的应用密钥 |
| `GITHUB_TOKEN` | — | 提高 GitHub API 额度 |
| `PUSHBOT_STARTUP_GRACE_MS` | `120000` | watchdog 启动宽限 |
