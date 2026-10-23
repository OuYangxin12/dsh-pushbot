# dsh-pushbot — 常驻 · headless · 自改进消息推送服务

基于 DeepSeek Harness 的常驻服务：定时从网上抓取你关心的内容，去重后推送到飞书/微信。
**纯 headless**：进程内没有 HTTP 服务、没有 Web UI，靠心跳文件与外部 watchdog 自愈。

```
~/pushbot/
├── home/                     # 独立 DSH_HOME（profiles / sessions / storages / logs）
│   └── profiles/pushbot/     # headless profile：@deepseek-ai/dsh-base + dsh-pushbot-app
├── app/packages/dsh-pushbot-app/   # 插件源码（唯一需要改的地方）
├── config.json               # 主题 / 源 / 通知器 / 调度
├── data/
│   ├── state.json            # 每个主题的 lastRunAt + 已见 id（去重游标）
│   ├── health.json           # 心跳 + 指标（watchdog 读它）
│   └── notifications.log     # file 通知器的投递记录
├── ops/                      # systemd unit + 健康检查 + 启停脚本
├── proposals/                # 自改进提案（P3）
└── versions/                 # 版本化发布（P2）
```

## 1. 先手动跑一轮

```bash
cd ~/pushbot
DSH_HOME=$HOME/pushbot/home PUSHBOT_ROOT=$HOME/pushbot PUSHBOT_RUN_ONCE=1 \
  dsh --profile pushbot
cat data/health.json data/notifications.log
```

## 2. 配置 `config.json`

- `notifiers`：通知器字典。`feishu-webhook` 适合飞书群自定义机器人（把 URL 换成你的），`file` 写本地文件，`webhook` 发任意 JSON。
- `topics[]`：一个主题 = 一组源 + 调度 + 通知器。
  - `everyMinutes`：轮询间隔
  - `quietHours`：免打扰区间，如 `["23:30","07:30"]`
  - `notifier`：用哪个通知器
  - `sources[]`：
    - `{ "kind": "rss", "url": "https://…/feed.xml", "limit": 10 }`
    - `{ "kind": "github", "repo": "owner/repo", "events": ["release", "commit"], "limit": 3 }`
- 改完不用重启：每轮都会重新读取配置。

飞书群机器人最小配置：

```json
"feishu": { "kind": "feishu-webhook", "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx" }
```

然后把某个 topic 的 `"notifier": "file"` 改成 `"notifier": "feishu"`。

## 3. 装成常驻服务（必须在普通终端执行）

**注意**：DSH 的 agent shell 运行在 bwrap 沙箱里，看不到 systemd 用户管理器，也无法改 crontab。
所以下面这条命令要你自己在登录终端里跑：

```bash
bash ~/pushbot/ops/install-service.sh
```

它会：
- 安装并启用 `dsh-pushbot.service`（`Restart=always`，开机自启，`MemoryMax=1G`）
- 安装 `dsh-pushbot-healthcheck.timer`（每分钟读 `data/health.json`，心跳过期/错误/RSS 超限就重启）
- `loginctl enable-linger`（不登录也跑）

查看状态：

```bash
systemctl --user status dsh-pushbot
journalctl --user -u dsh-pushbot -f
cat ~/pushbot/data/health.json
```

卸载：`bash ~/pushbot/ops/uninstall-service.sh`

### 没有 systemd 的备选

```bash
crontab -e
# 加入：
@reboot      /home/oyx/pushbot/ops/ensure.sh
*/5 * * * *  /home/oyx/pushbot/ops/ensure.sh
```

## 4. 常用诊断

| 现象 | 查什么 |
|---|---|
| 没收到推送 | `data/health.json` 的 `phase` / `sources`；`data/notifications.log`；`journalctl --user -u dsh-pushbot` |
| 一直重启 | `health.json` 里 `phase=error` 的 `error` 字段；多半是 `config.json` 语法或网络 |
| RSS 抓不到 | 源可能被墙/改版；`curl -sS <url> | head` 验证；换 `kind: github` 或走代理 |
| GitHub 403 | 匿名 60 次/小时限流；把 `everyMinutes` 调大，或换 `gh api` 代理方案（P1） |
| 想看某主题状态 | `cat data/state.json`，`seen` 是已推送的条目 id |

## 5. CI / CD（本地）

**CI**（无网络依赖，约 3 秒）

```bash
bash ~/pushbot/ops/ci.sh          # 语法检查 + node --test
```

- 测试在 `app/packages/dsh-pushbot-app/test/*.test.js`，夹具在 `test/fixtures/`
- 纯逻辑在 `lib/core.js`（`parseFeed` / `stripTags` / `inQuietHours` / `isDue` / `formatDigest`），`lib/index.js` 只做 I/O
- `git commit` 经 `.git/hooks/pre-commit` 自动跑 CI，不过就提交失败

**CD**

```bash
bash ~/pushbot/ops/build.sh              # CI + 生成 versions/vNNN（manifest + sha256）
node ~/pushbot/ops/promote.mjs           # 部署最新构建
node ~/pushbot/ops/promote.mjs v002      # 部署指定构建
node ~/pushbot/ops/promote.mjs rollback  # 回滚到上一个构建
```

流程：校验 sha256 → 原子切换 `versions/current` → 重启 → 等 60 秒内心跳 → 失败自动回滚。
每次发布记入 `data/deploys.json`；`data/health.json` 的 `build` 字段就是当前生效版本。

**关键教训**：DSH 在插件加载失败时**不会退出**，只打印 warning 后继续跑基座。所以"进程活着"≠"服务正常"——健康门禁只看心跳；`ops/ensure.sh` 同样先查心跳新鲜度，再决定是否杀掉重启。

## 6. 路线图

- **P0（已完成）**：headless 常驻体、RSS+GitHub 源、去重、心跳、webhook 推送、systemd/cron 自愈
- **P1**：更多源（热搜/关键词搜索/网页选择器）、outbox 重试、`ctx.llm` 摘要、日报聚合
- **P2（已完成）**：`versions/` 版本化 + `promote.mjs` 蓝绿发布 + 自动回滚 + 本地 CI
- **P3**：`pushbot-improver` 创造模式自改进（cordis_inspect + plugin_manager + 门禁 + 人批）
