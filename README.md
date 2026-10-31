# dsh-qq-bridge

DSH ⇄ QQ 双向桥。装上它之后：

- **这边说，那边就收到**：我在 DSH 里能直接用 `qq_send` 工具往 QQ 发消息
- **那边说，这边就回应**：你在 QQ 上发一句，就能驱动 DSH 开一轮（人格、历史、工具、记忆全都自带）
- **聊天数据互通**：QQ 来的消息带着来源标记进会话，回话又发回 QQ

## 需要什么

一个能用的 OneBot v11 实现（本机是 SnowLuma）。HTTP 用来发，WS 用来收。

## 配置

`~/.dsh/qqbridge/config.json`：

```json
{
  "http": "http://127.0.0.1:3000",     // OneBot HTTP
  "token": "<HTTP token>",              // 发消息要它
  "ws": "ws://127.0.0.1:3001",          // OneBot WS
  "ws_token": "<WS token>",             // 收消息要它（和上面那个不一样！）
  "默认收件人": "3974780024",
  "QQ来的消息": true,                    // 关掉就只发不收
  "允许": ["3974780024"],                // 白名单，空数组=谁都行
  "每会话限速秒": 3,
  "会话": ""                             // 留空 = 自动用最近活跃的会话
}
```

⚠ **两个 token 不一样**：HTTP 那个和 WS 那个是各自独立的。填错了会一直 401。

## 注册的工具

| 工具 | 干什么 |
|---|---|
| `qq_send` | 发消息（`文本` 必填，`发给` / `群` 可选） |
| `qq_friends` | 列好友，拿 QQ 号 |
| `qq_groups` | 列群，拿群号 |
| `qq_status` | 查机器人是不是在线 |

## 消息怎么过去的

QQ 来一条 → 拼成 `【QQ 消息｜QQ私聊 · 昵称(QQ号)】正文` → `agent.followup()`
→ DSH 照常开一轮 → 我要是想回话，就用 `qq_send` 发回去。

**为什么必须走 followup**：那才是 DSH 自己的回合。自己在插件里拼上下文塞一段死文字是假的 —— 模型不会被调用，历史也不是会话自己的。

**角色只能是 user**：`dsh-agent-loop` 把收件箱认领的消息写死成 `user/message` 事件，用 `developer` 角色会直接抛错。所以 QQ 来的消息是 `source.kind = "qq-remote"` 的 user 消息 —— 角色上是 user，来源标记说是 QQ。

## 常见问题

**`连得上但不响应`** → Termux/容器被 Android 冻结了。切回 Termux App 让它回前台，`termux-wake-lock` 可以长期防冻结。

**`token 不对（401）`** → config.json 里的 token 填错了，或者机器人换了账号。

**收不到消息** → 检查 `ws_token`（不是 `token`），检查 `QQ来的消息` 是不是 true。

**QQ 消息送不进去** → 大概率没有活着的会话。在 DSH 里开一个会话放着别关。

## 装法

已经装进 `~/.dsh/profiles/web/` 了：

```
profiles/web/node_modules/dsh-qq-bridge/   ← 插件本体（从 ~/.dsh/qqbridge/plugin 拷过去的）
profiles/web/package.json                  ← dependencies + dsh.profile.bundles 里各加了一条
```

改了插件源码之后要重新拷一次：

```bash
cp -r ~/.dsh/qqbridge/plugin/* ~/.dsh/profiles/web/node_modules/dsh-qq-bridge/
```

然后重启 DSH。

## License

GPL-3.0-or-later · 作者 [xiawan-promax](https://github.com/xiawan-promax)
