# 可靠性与自愈

[返回 README](../README.md)

## 投递语义

每份摘要**先入队再投递**，不存在"发了但没记、或记了但没发"的中间态。

1. 抓取 → 去重 → 摘要 → 写 `data/outbox.json` 的 `pending`
2. 投递成功 → 从 `pending` 移除
3. 投递失败 → `attempts+1`，按 `1→2→4→…→30 分钟` 退避，最多 8 次
4. 超过上限 → 移入 `dead`（保留最近 50 条现场，不自动删除）

因此：进程崩溃、网络抖动、主 DSH 重启都不会造成内容丢失，只会延后。

## 去重

- 每个主题维护已见条目 id 列表（最多 1000 条），存在 `data/state.json`
- 跨源同一内容不会重复推
- 网页变更源用内容哈希作为 id，变化才产生新 id
- 想强制重推某主题：把 `state.json` 里该主题的 `seen` 清空

## 源隔离

单个源失败只记 `health.sources.failing` 并写日志，不影响同主题其他源；
所有源都失败时该轮不产生内容，也不会重复推送旧条目。

## 心跳与 watchdog

服务每轮写 `data/health.json`：

| 字段 | 含义 |
|---|---|
| `phase` | `starting` / `ok` / `idle` / `error` |
| `lastCycleAt` | 最近一次完整周期时间 |
| `sources.ok/failing` | 本轮源成功/失败数 |
| `deliveries` / `deliveryFailures` | 累计投递成功/失败 |
| `outboxPending` / `outboxDead` | 队列积压与死信数 |
| `rssMb` | 常驻内存 |
| `build` | 当前生效的构建号（对应 `versions/`） |

`dsh-pushbot-healthcheck.timer` 每分钟读它：

- 文件缺失、`phase=error`、心跳超过 `2.5 × 最大轮询间隔`、RSS 超 800MB → `restart`
- 服务启动后 `PUSHBOT_STARTUP_GRACE_MS`（默认 2 分钟）内只观察不重启

**只看进程存活是不够的**：DSH 在插件加载失败时不会退出进程，会留下"活着但不干活"的僵尸。
所以健康判断一律基于心跳，而不是 `is-active`。

## 发布与回滚

见 [development.md](development.md#发布与回滚)。发布后 60 秒内必须进入 `ok`/`idle` 心跳，
否则自动切回上一个构建并记录 `rollback-after-failure`。
