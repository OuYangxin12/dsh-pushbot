# 安装与运行

[返回 README](../README.md)

## 前置条件

- Node.js ≥ 22
- `dsh`（`npm i -g @deepseek-ai/dsh`）
- Linux + systemd user（无 systemd 时可用 cron 兜底）

## 安装为常驻服务

```bash
cd ~/pushbot
bash ops/install-service.sh
```

脚本会：

1. 从当前环境解析 `node` 与 `dsh` 的真实路径，渲染 `ops/systemd/*.service.in` 模板
2. 写入 `~/.config/systemd/user/`，执行 `daemon-reload`
3. 启用并（重新）启动 `dsh-pushbot.service`
4. 启用 `dsh-pushbot-healthcheck.timer`
5. 若存在 `home/improve.env`，额外启用 `dsh-pushbot-improve.timer`
6. `loginctl enable-linger`，使未登录时也保持运行

安装后可随时重跑同一命令：它会重新渲染模板并重启服务。

## 服务管理

```bash
systemctl --user status dsh-pushbot
systemctl --user restart dsh-pushbot
systemctl --user stop dsh-pushbot
systemctl --user disable --now dsh-pushbot
journalctl --user -u dsh-pushbot -f
```

定时器：

```bash
systemctl --user list-timers 'dsh-pushbot*'
systemctl --user disable --now dsh-pushbot-improve.timer   # 暂停夜间自改进
```

## 手动跑一轮（不常驻）

用于验证配置或补一次抓取：

```bash
bash ops/run-once.sh
```

等价于：

```bash
DSH_HOME=$HOME/pushbot/home PUSHBOT_ROOT=$HOME/pushbot PUSHBOT_RUN_ONCE=1 \
  dsh --profile pushbot
```

注意：`run-once` 与常驻服务共用 `data/`，同一主题的去重游标会被推进。

## 没有 systemd 时

```bash
crontab -e
@reboot      $HOME/pushbot/ops/ensure.sh
*/5 * * * *  $HOME/pushbot/ops/ensure.sh
```

`ensure.sh` 先查心跳新鲜度，再决定是否杀掉重启——不是只看进程是否存在。

## 卸载

```bash
bash ops/uninstall-service.sh    # 只移除 systemd 单元
```

`home/`、`data/`、`versions/` 会保留，删除目录即可彻底清理。

## 本机部署状态

| 组件 | 状态 |
|---|---|
| `dsh-pushbot.service` | enabled + active，开机自启，`Restart=always`，`MemoryMax=1G` |
| `dsh-pushbot-healthcheck.timer` | 每分钟检查心跳，异常时重启（含 2 分钟启动宽限） |
| `dsh-pushbot-improve.timer` | 每天 03:00 自改进 |
| 凭据 | `home/feishu.env`、`home/improve.env`（均 0600，不进 git） |
