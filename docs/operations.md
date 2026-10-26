# 日常运维与排障

[返回 README](../README.md)

## 常用命令

```bash
systemctl --user status dsh-pushbot            # 服务状态
journalctl --user -u dsh-pushbot -f            # 实时日志
cat ~/pushbot/data/health.json                 # 心跳与指标
cat ~/pushbot/data/state.json                  # 各主题去重游标
cat ~/pushbot/data/outbox.json                 # 投递队列与死信
ls ~/pushbot/data/reports/                     # 日报
bash ~/pushbot/ops/run-once.sh                 # 立刻跑一轮
```

## 排障表

| 现象 | 查什么 |
|---|---|
| 没收到推送 | `health.json` 的 `phase` / `sources` / `outboxPending`；`outbox.json` 的 `lastError` |
| 服务反复重启 | `health.json` 的 `error`；多为 `config.json` 语法或网络 |
| 某个源持续失败 | `sources.failing` 与 `journalctl` 里 `source failed ... kind=...` |
| 重复收到同一条 | `state.json` 里该主题 `seen` 是否被清空或写入失败 |
| 推送延迟很久 | `outbox.json` 的 `attempts` 与 `nextAttemptAt`（退避中） |
| 飞书报错 | [channels.md](channels.md) 的报错表 |
| 改进没生效 | `data/improve.log` 的 gate verdict；`data/improvements.json` 的 `reasons` |
| 想看门禁为什么拒绝 | `node ops/gate.mjs --diff-base <ref> --json` 的 `reasons` |

## 网络抖动

国内到部分站点（openai.com、api.github.com、Hugging Face）会间歇性不可达。服务已经做了两件事：

- **GET 自动重试**：默认 2 次，线性退避（`PUSHBOT_FETCH_RETRIES` / `PUSHBOT_RETRY_DELAY_MS`）
- **POST 不重试**：投递的重复风险由 outbox 的幂等语义控制

GitHub API 匿名额度只有 60 次/小时，多源 + 重试很容易打满（表现为 `HTTP 403`）。
把 token 写进 `home/github.env`（`GITHUB_TOKEN=...`）后额度升到 5000/小时，
systemd 通过 `EnvironmentFile` 自动加载。

## 常见处置

**某个来源一直失败**：先确认地址可达（`curl -sS <url> | head`），再决定停用或改 `everyMinutes`。
GitHub 403 多为匿名限额（60/h），配 `GITHUB_TOKEN` 或调大间隔。

**关掉噪音主题**：在 `config.json` 里删掉该 topic 或把 `notifier` 改成 `file`，无需重启。

**磁盘增长**：`data/` 的 `reports/`、`improvements/` 会累积，可定期清理；
日志走 journald，由 `SystemMaxUse` 控制。

**彻底重置去重**：删除 `data/state.json`（下一轮会重新建立基线，首轮不会重复推网页基线）。

## 安全边界

- 飞书应用密钥与模型密钥只在 `home/*.env`（0600），不进 git
- 服务默认不监听任何端口（headless），不存在被外部访问的面
- `ops/` 由 `ops/CHECKSUMS` 冻结，自改进流程不能修改它
