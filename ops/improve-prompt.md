# 任务：对 dsh-pushbot 做一次有边界的自我改进

你是这个常驻推送服务的维护者。服务代码在 `~/pushbot/app/packages/dsh-pushbot-app/`，
它每隔几分钟抓取 RSS / Hacker News / V2EX / 网页变更 / 关键词搜索，去重后推送到飞书或微信。

## 第一步：观察（只读，不要改任何东西）

读这些文件，找出**一个**最有价值的改进点：

- `data/health.json` —— 运行指标：`phase`、`sources.ok/failing`、`deliveryFailures`、
  `outboxPending`、`outboxDead`、`rssMb`
- `data/state.json` —— 每个主题的 `seen` 游标、`lastRunAt`
- `data/outbox.json` —— 投递失败或被判死的条目，看 `lastError`
- `data/reports/*.md` —— 历史上推送了什么
- `data/improvements.json` —— 之前每次自动改进的结论；**不要重复已经被判定为无效的改动**
- `ops/improve.log` 尾部 —— 上一轮改进器自己的运行记录

也可以读 `README.md` 和 `app/packages/dsh-pushbot-app/test/` 了解现有约定。

## 第二步：选一个改动（只选一个）

优先级从高到低：

1. **真实故障**：某个源持续失败、解析错误、投递失败（`outbox.json` 里有 `lastError`）
2. **可靠性**：漏推、重复推、重试不收敛
3. **可观测性**：指标不足以定位问题
4. **明确的新能力**（例如支持一个新的抓取源种类）

禁止：修改 `config.json`（那是用户数据）、修改 `ops/`（那是刹车）、
新增运行时依赖、大范围重构、改数据库结构。

## 第三步：写提案

在 `proposals/` 下新建 `NNN-短标题.md`（编号接着已有的往下排），内容：

```markdown
# 提案：<一句话>

## 现状与证据
（引用具体文件与数字，例如 outbox.json 里 3 条 lastError="HTTP 404"）

## 假设
（为什么会这样）

## 改动
（改哪些文件、改什么）

## 预期指标
（改完之后哪个数字应该从多少变成多少）

## 回滚
（怎么撤销）
```

## 第四步：实现并自测

1. 只改 `app/packages/dsh-pushbot-app/` 下的文件
2. 纯逻辑放进 `lib/core.js` 或新模块，保证可单测
3. **必须**在 `test/` 下补测试，覆盖你修的那个 bug 或加的那个能力
4. 跑 `bash ops/ci.sh`，必须全绿。失败就继续改，直到绿。
5. 单次改动控制在 **≤400 行、≤3 个文件**，否则会被门禁直接拒绝

## 第五步：提交

```bash
git add -A
git commit -m "improve: <一句话说明>"
```

只提交一次。不要 push，不要打 tag。

## 绝对不要做

- 不要运行 `ops/build.sh` / `ops/promote.mjs`（发布由外层编排脚本决定）
- 不要修改 `ops/` 下任何文件（会被冻结校验拒绝）
- 不要修改 `config.json`、`config.example.json`、`README.md`（文档改动需要人批）
- 不要在代码、日志或提交信息里写任何密钥、webhook URL、bot id
- 不要删除或弱化现有测试

## 如果找不到值得改的地方

不要硬凑。在 `proposals/` 下写一篇说明"本轮没有达到改动门槛，原因是……"，然后直接结束，不要提交代码。
