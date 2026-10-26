# 开发、构建与发布

[返回 README](../README.md)

## 目录结构

```
app/packages/dsh-pushbot-app/   服务插件（唯一会被自改进修改的目录）
  lib/core.js                   纯逻辑：解析、过滤、退避、摘要、载荷构造
  lib/sources.js                抓取源适配器（fetch 可注入，便于测试）
  lib/outbox.js                 投递队列：入队 / 退避 / 死信
  lib/index.js                  编排：调度、去重、摘要、推送、心跳
  test/                         单测 + fixtures
ops/                            刹车与运维（CHECKSUMS 冻结）
  systemd/*.in                  systemd 模板，安装时渲染
  lib/gate-rules.mjs            门禁纯函数
  gate.mjs / freeze.mjs         门禁执行与冻结校验
  improve.sh / approve.mjs      自改进编排与人批
docs/                           本文档目录
```

## 本地 CI

```bash
bash ops/ci.sh        # 语法检查 + 单元测试，无需网络
bash ops/install-hooks.sh   # 安装 pre-commit，提交前自动跑
```

用例分布：服务插件 35+ 个（解析、去重、过滤、退避、网页归一化、源适配器、载荷构造），
门禁规则 14 个（越权、超量、CI 失败、冻结漂移、密钥、频率、churn）。
GitHub Actions 跑同样的命令（`.github/workflows/ci.yml`）。

## 发布与回滚

```bash
bash ops/build.sh                 # 跑 CI，产出 versions/vNNN + manifest（全量 sha256）
node ops/promote.mjs              # 部署最新构建
node ops/promote.mjs v008         # 部署指定构建
node ops/promote.mjs rollback     # 回滚到上一个
```

流程：

1. 校验 `manifest.json` 里每个文件的 sha256
2. 原子切换 `versions/current` 符号链接
3. `systemctl --user restart`
4. 60 秒内必须出现 `phase` 为 `ok`/`idle` 且 `startedAt` 晚于发布时刻的心跳
5. 否则自动切回上一个构建、重启、记录 `rollback-after-failure`

`.git/hooks` 之外的记录：`data/deploys.json` 保留全部发布与回滚历史；
`health.json` 的 `build` 字段即当前生效版本。

## 新增一个抓取源

1. 在 `lib/sources.js` 加一个 `case`，返回 `{ items, state? }`
2. 条目统一结构：`{ id, title, url, date?, summary?, source }`
3. 在 `test/sources.test.js` 用假 `fetchJson`/`fetchText` 覆盖成功与边界
4. `bash ops/ci.sh` 通过后提交

## 自改进

见 [self-improvement.md](self-improvement.md)。核心约定：`ops/` 不可被自动修改，
`app/packages/` 之外的动作都需要人批。
