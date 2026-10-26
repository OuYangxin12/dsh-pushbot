# dsh-pushbot

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的常驻消息推送服务：
定时抓取你关心的内容，去重、可选摘要后推送到飞书。

进程内**没有 HTTP 服务、没有 Web UI**，靠心跳文件与外部 watchdog 自愈，因此可以长时间无人值守运行。
服务还能按天用 DSH 的创造模式（cordis preset）读自己的指标、改自己的代码，
但必须通过一套不依赖模型自觉的机械门禁：低风险自动发布，高风险等人批准。

```
hackernews · hn-search · v2ex · rss/atom
github release/commit · 网页变更与断言
        │
        ▼
  去重 → 过滤 → (可选) LLM 摘要 → outbox → 飞书
                                      │
                         失败退避重试 / 死信保留
```

## 特性

- **6 类抓取源**：RSS/Atom、GitHub releases/commits、Hacker News 热榜、HN 关键词搜索、V2EX 热帖、网页变更与断言监控
- **不丢内容**：先入队再投递，失败按 1→30 分钟指数退避，超过 8 次进死信
- **可选摘要**：用你已配置的模型把条目改写成手机可读简报；无 key 或失败自动降级，不影响送达
- **飞书三种接法**：应用直连（最独立）、dsh-im 主动投递、群自定义机器人
- **可自愈**：每分钟心跳检查，僵尸进程与 RSS 超限都会自动重启
- **可回滚**：版本化发布 + 健康门禁 + 自动回滚，失败不留残局
- **带控制面板**：DSH 设置里的 Pushbot 页面可看状态、改主题、测试推送、重启服务

## 快速开始

```bash
# 1. 装成 systemd user 服务（开机自启、崩溃自愈）
bash ops/install-service.sh

# 2. 接入飞书（自动发现已接入的智能体、读凭据、发测试消息）
node ops/set-feishu-app.mjs

# 3. 立刻跑一轮验证
bash ops/run-once.sh
```

详细步骤见 [docs/getting-started.md](docs/getting-started.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/getting-started.md](docs/getting-started.md) | 安装、服务管理、手动运行、卸载 |
| [docs/channels.md](docs/channels.md) | 三种飞书接法、webhook、报错码 |
| [docs/panel.md](docs/panel.md) | 控制面板：看到什么、能改什么、能做什么 |
| [docs/configuration.md](docs/configuration.md) | 配置全字段、抓取源、LLM 摘要、日报 |
| [docs/reliability.md](docs/reliability.md) | 投递队列、去重、心跳与自愈 |
| [docs/operations.md](docs/operations.md) | 日常命令、排障、安全边界 |
| [docs/self-improvement.md](docs/self-improvement.md) | 自改进闭环、门禁、人批 |
| [docs/development.md](docs/development.md) | 目录结构、CI/发布、新增抓取源 |
| [docs/architecture.md](docs/architecture.md) | 设计决策与交付记录 |

完整索引：[docs/](docs/README.md)

## 状态

P0–P3 已完成：常驻服务、6 类源与可靠性、CI/CD 与自动回滚、创造模式自改进。
未做：更多社交平台源、摘要质量评估、跨机器迁移。

## 许可

尚未指定许可证；在明确授权前请勿分发。
