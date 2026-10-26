# 控制面板

[返回 README](../README.md) · [文档索引](README.md)

控制面板是一个装在 **主 DSH 里** 的插件（不是 pushbot 进程的一部分）。它直接读写
`~/pushbot` 的配置与数据，并用 `systemctl --user` 控制服务——pushbot 本身继续保持 headless。

## 打开

DSH Web → **设置 → Pushbot**。

安装（在仓库里开发时）：

```bash
# 由 DSH 的插件管理器安装，会写入当前 profile 的 bundle 列表
# 在 DSH 里让 agent 执行：plugin_manager install_bundle /home/oyx/pushbot/app/packages/dsh-pushbot-panel
```

卸载：插件管理里移除 `dsh-pushbot-panel`，或 `plugin_manager` 的 `remove_bundle`。

## 能看到什么

| 区域 | 内容 |
|---|---|
| 顶部 | 服务是否运行、版本、构建号、重启次数、数据目录 |
| 指标卡 | 心跳 phase、上次抓取、投递队列（待发/死信）、源成功失败数、累计投递、内存 |
| 主题表 | 每个主题的源数量与类型、间隔、通道、启用状态、已见条数、上次运行 |
| 最近推送 | 最近 12 条推送记录（时间 / 主题 / 标题） |
| 最近变更 | 最近一次部署与最近一次自改进判定 |

每 5 秒自动刷新。

## 能改什么

- **间隔**：1–1440 分钟，超出会被夹到边界
- **通道**：在已配置的通知器之间切换
- **启用/暂停**：写 `disabled: true`，服务下一轮跳过该主题
- **保存**：写 `config.json`，下一轮自动生效，**不需要重启服务**

## 能做什么

| 按钮 | 行为 |
|---|---|
| 立即运行一轮 | 后台跑 `ops/run-once.sh` |
| 测试推送 | 跑 `ops/test-push.mjs`，用主题实际使用的通道发一条测试消息 |
| 重启服务 | `systemctl --user restart dsh-pushbot` |
| 跑一次自改进 | 后台跑 `ops/improve.sh`（受冻结校验与门禁约束） |

## 实现与安全

主机半 `app/packages/dsh-pushbot-panel/index.js` 注册三条路由：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/dsh-pushbot/overview` | 状态、主题、队列、最近记录 |
| POST | `/api/dsh-pushbot/config` | 应用主题改动（字段白名单，原子写） |
| POST | `/api/dsh-pushbot/action` | `run-once` / `test-push` / `restart` / `improve` |

- 请求先过 Connection 的 Host/Origin 与浏览器登录栅栏（`connection.requestRejection`），失败即拒绝
- 写操作必须带 `content-type: application/json`，请求体上限 256 KiB
- 只能改主题的 `everyMinutes` / `notifier` / `disabled`；其他字段一律忽略
- 服务只监听回环，面板不额外开放端口

客户端半 `client.js` 注册在 `settings.section` 槽位，用 `--dsw-alias-*` 主题变量渲染，
深浅色跟随宿主。

## 排障

| 现象 | 查什么 |
|---|---|
| 面板显示"读取失败" | 主 DSH 是否在跑；`journalctl --user -u dsh-pushbot` |
| 改了不生效 | 是否点了"保存改动"；`data/health.json` 的 `lastCycleAt` 是否在推进 |
| 测试推送失败 | 直接跑 `node ops/test-push.mjs` 看具体错误 |
| 面板不出现 | 插件是否启用；刷新一次页面（客户端模块需要重新加载） |
