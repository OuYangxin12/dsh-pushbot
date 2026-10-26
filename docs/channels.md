# 推送通道

[返回 README](../README.md) · 配置字段见 [configuration.md](configuration.md)

三种飞书接法，各有一个配置脚本。

| 方案 | 出口 | 依赖 | 适用 |
|---|---|---|---|
| A. 飞书应用直连 | 调飞书 Open API 发到智能体私聊 | 仅应用凭据 | 最独立，主 DSH 关掉也能推 |
| B. dsh-im 主动投递 | 主 DSH 的 `/api/dsh-im/delivery/messages` | 主 DSH 必须运行 | 复用现有连接 |
| C. 群自定义机器人 | webhook | 无 | 群内共享 |

## A. 飞书应用直连

```bash
node ops/set-feishu-app.mjs                 # 卡片（markdown）
node ops/set-feishu-app.mjs --format plain  # 纯文本
```

它从 `~/.dsh/integrations` 找到已接入的飞书智能体，从 `~/.dsh/.credentials.yaml`
取应用密钥，发一条测试消息，成功后写：

- `home/feishu.env`（0600）：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`
- `config.json`：`notifiers["feishu-app"]`，并把仍指向 `file`/`feishu` 的主题切过来

密钥由 systemd `EnvironmentFile` 注入，不写进 `config.json`。
需要的应用权限：`im:message:send_as_bot`。

## B. dsh-im 主动投递

```bash
node ops/set-im.mjs --target <targetId>
```

`targetId` 在 DSH「设置 → IM机器人 → 机器人卡片齿轮 → 新建目标 → 复制调用参数」里拿。
注意：交付目标是运行中主机的内存态，必须先在 UI 创建；写配置文件不会热加载。

可选参数：`--bot <botId>`、`--base-url`、`--format`、`--keep-notifiers`、`--test-only`。

## C. 群自定义机器人

飞书群 → 右上角「…」→ 设置 → 群机器人 → 添加机器人 → **自定义机器人** → 复制 webhook：

```bash
node ops/set-feishu.mjs 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
node ops/set-feishu.mjs 'https://.../hook/xxx' --secret <签名密钥>
```

| 报错 | 原因 | 处理 |
|---|---|---|
| `code=19021` / 提到 `sign` | 开了签名校验 | 加 `--secret <密钥>` |
| 提到「关键词」 | 开了关键词校验 | 安全设置里加关键词「新内容」 |
| `code=19001` | 地址不完整 | 重新复制整条 webhook |

## 其他通道

```json
"notifiers": {
  "file": { "kind": "file", "path": "data/notifications.log" },
  "hook": { "kind": "webhook", "url": "https://example.com/hook",
            "headers": { "authorization": "Bearer xxx" } }
}
```

`webhook` 默认发送 `{"text": "..."}`；需要自定义结构时给 `body`。

## 凭据边界

- `config.json` 不存放密钥，只放引用与 id
- 密钥放 `home/*.env`（0600，`home/` 已被 `.gitignore` 忽略）
- 应用直连的 token 在进程内缓存，提前 60 秒过期；遇到 `99991661/99991663/99991668` 自动强刷一次重试
