# 自改进（创造模式）

[返回 README](../README.md)

每天 03:00 或手动 `bash ops/improve.sh` 触发一次。

## 闭环

```
冻结校验 → 跑改进器 → 机械门禁 → 发布 / 人批 / 拒绝 → 记账
```

1. **冻结校验**：`ops/freeze.mjs --verify` 比对 `ops/CHECKSUMS`（28 个文件）。
   不一致立即中止——改进器不能修改自己的刹车。
2. **跑改进器**：`pushbot-improver` profile 是独立的 headless DSH 组合，
   含 `cordis-host-runner`、`tool-cordis`（`cordis_inspect_*`）、`plugin_manager`
   与四个创造模式 skill。它读 `data/` 里的指标，写提案到 `proposals/`，
   改 `app/packages/` 的代码、补测试、跑 CI、提交。
3. **机械门禁**：`ops/gate.mjs` 按固定规则判定，不依赖模型自觉。
4. **执行与记账**：结果写入 `data/improvements.json`，patch 存档到 `data/improvements/`。

## 门禁判定

| 判定 | 条件 | 动作 |
|---|---|---|
| `pass` | 只改 `app/packages/`；≤3 文件、≤400 行；CI 绿；冻结完好；当日未自动发布 | 自动 build + promote |
| `approval` | 改了 `README.md` / `config.example.json`；或同一文件 7 天内已改 2 次 | 生成人批请求并推送 |
| `blocked` | 越权路径；超量；CI 失败；冻结漂移；diff 含密钥；有未提交改动；当日已自动发布 | 不发布，记录原因 |

规则实现是纯函数（`ops/lib/gate-rules.mjs`），有 14 个单测覆盖。

## 人批

```bash
node ops/approve.mjs list
node ops/approve.mjs approve <id> --by 你的名字
node ops/approve.mjs reject <id> --note "理由"
```

请求会通过已配置的通知器推送；批准记录写在 `data/approvals/<id>.json`。

## 自治级别

`config.json` 的 `automation.improve` 决定门禁通过后的行为（也可在控制面板「偏好」里改）：

| 值 | 行为 |
|---|---|
| `auto` | 低风险改动自动 build + promote |
| `approval` | 一律转人工批准，即使门禁判定为 pass |
| `off` | 定时任务直接退出，不做任何改动 |

```bash
# 临时演练：不跑模型，只走到门禁
PUSHBOT_IMPROVE_DRY_RUN=1 bash ops/improve.sh
```

## 凭据

改进器跑在独立 `DSH_HOME`，需要自己的模型密钥：

```bash
cp ops/improve.env.example home/improve.env
chmod 600 home/improve.env     # 填 DEEPSEEK_API_KEY
bash ops/install-service.sh    # 之后再跑一次以启用 timer
```

## 演练（不花钱、不发布）

```bash
# 只走到门禁，不跑模型
PUSHBOT_IMPROVE_DRY_RUN=1 bash ops/improve.sh

# 用注入命令模拟改进器，可覆盖 pass / approval / blocked / no-op 四条分支
PUSHBOT_IMPROVE_CMD='printf "\n// x\n" >> app/packages/dsh-pushbot-app/lib/core.js && git commit -qam "improve: drill"' \
  bash ops/improve.sh
```

## 边界

- 只允许改 `app/packages/`
- `ops/`、`config.json`、`README.md`、`config.example.json` 都受保护或需人批
- 不做数据库迁移、不新增运行时依赖
- 自动发布 ≤1 次/天；同一文件 7 天内最多改 2 次
