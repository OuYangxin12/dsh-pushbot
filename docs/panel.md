# 控制面板

[返回 README](../README.md) · [文档索引](README.md)

控制面板是一个装在 **主 DSH 里** 的插件，不是 pushbot 进程的一部分。它直接读写
`~/pushbot` 的配置与数据，并用 `systemctl --user` 控制服务——pushbot 本身继续保持 headless。

打开：DSH Web → **设置 → Pushbot**。

## 四个标签页

### 概览

服务是否运行、版本、构建号、重启次数；心跳、上次抓取、投递队列、源成功失败、累计投递、内存；
按钮：立即运行一轮 / 测试推送 / 重启服务 / 跑一次自改进；最近 12 条推送记录。

### 主题

- **新增 / 删除主题**，改名字、间隔、通道、启用状态
- **免打扰**：两个 `HH:MM` 输入框，留空即关闭
- **关键词过滤**：必须包含 / 排除，逗号分隔
- **抓取源**：逐个显示类型与可编辑字段；可移除、可添加空源
- 改动后点「保存改动」，写入 `config.json`，**下一轮自动生效，不需要重启服务**

### 偏好

| 项 | 作用 |
|---|---|
| LLM 摘要 | 启用、模型、接口地址、密钥环境变量名、每日调用上限 |
| 每日日报 | 时间 + 通道，可整体关闭 |
| 自改进自治级别 | `auto` / `approval` / `off` |
| 通道 | 只读展示（通道与密钥由 `ops/set-*.mjs` 脚本管理） |

### 源目录

按类别浏览预置源，选好目标主题后一键添加：

- **资讯**：Hacker News 首页、OpenAI 新闻、Cloudflare 博客、Simon Willison、Solidot、少数派、阮一峰、GitHub 博客
- **榜单**：HN 热榜、HN 关键词搜索、GitHub 热门新仓库
- **社区**：V2EX 热帖
- **模板**：GitHub 仓库发布、网页内容变更、网页状态断言、任意网页列表、任意 JSON 接口

标「模板」的需要先填地址/正则再添加。这些 URL 是实测可用的；坏掉的源会出现在
`health.json` 的 `sources.failing` 里。

## 接口

主机侧注册三条路由，全部先过 Connection 的 Host/Origin 与浏览器登录栅栏：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/dsh-pushbot/overview` | 状态、指标、完整配置、源种类目录 |
| POST | `/api/dsh-pushbot/config` | 校验并写入整份配置（`{ config }`） |
| POST | `/api/dsh-pushbot/action` | `run-once` / `test-push` / `restart` / `improve` |

## 安全

- 写操作必须带 `content-type: application/json`，请求体上限 512 KiB
- **通道配置（含密钥引用）由磁盘保留，面板提交的同名字段会被忽略**
- 每个主题、每个源、每个字段都有白名单与范围限制：未知源类型丢弃、缺必填字段丢弃、
  间隔夹在 1–1440 分钟、条目数夹在合理区间、主题 id 冲突自动去重
- 服务只监听回环，面板不额外开放端口

## 热更新

- **客户端**（`client.js`）：刷新页面即可加载新版本
- **主机端**（`index.js`）：在插件管理里禁用再启用 `dsh-pushbot-panel` 会重新加载模块，
  不需要重启 DSH。启动后会在 `data/panel-host.json` 写入 `schemaVersion`，可据此确认版本

## 排障

| 现象 | 查什么 |
|---|---|
| 顶部出现"需要重启一次 DSH"的提示 | 主机端还是旧版本：到插件管理里禁用再启用 `dsh-pushbot-panel` |
| 面板显示"读取失败" | 主 DSH 是否在跑；`journalctl --user -u dsh-pushbot` |
| 保存后报错 | 提示里会给出具体字段（例如"第 2 个主题无效：缺少名称或至少一个合法源"） |
| 改了不生效 | 是否点了保存；`data/health.json` 的 `lastCycleAt` 是否在推进 |
| 测试推送失败 | 直接跑 `node ops/test-push.mjs` 看具体错误 |
