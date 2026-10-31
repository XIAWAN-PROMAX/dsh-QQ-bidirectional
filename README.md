<div align="center">

# dsh-QQ-bidirectional

**DSH ⇄ QQ 双向桥**

在 DSH 里说一句话，QQ 上就收到；在 QQ 上说一句话，DSH 就开一轮。

[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg)](LICENSE)
[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-8b5cf6.svg)](https://github.com/deepseek-ai)
[![OneBot v11](https://img.shields.io/badge/OneBot-v11-00a1f1.svg)](https://github.com/botuniverse/onebot-11)

</div>

---

## 这是什么

一个 **DeepSeek Harness（DSH）插件**，把 QQ 接进 DSH 的会话系统里。

装它之前，DSH 是你的聊天窗口；装它之后，**QQ 也是**。

而且 —— 这不是「转发」意义上的桥。QQ 来的每一条消息都会走
`agent.followup()`，也就是说：

> 从 QQ 触发的那一轮，是 **DSH 自己的回合** —— 人格、历史、工具、记忆，
> 全都是会话自己的，跟你坐在手机前面打字走的是**完全同一条路**。

## 两个方向

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   DSH 里说话                                                  │
│      │                                                       │
│      │  qq_send 工具                                         │
│      ▼                                                       │
│   OneBot HTTP :3000  ────►   QQ 好友 / QQ 群                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   QQ 里说话                                                   │
│      │                                                       │
│      ▼                                                       │
│   OneBot WebSocket :3001                                     │
│      │                                                       │
│      │  agent.followup()                                     │
│      ▼                                                       │
│   DSH 开一轮  ——►  人格 · 历史 · 工具 · 记忆                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**聊天数据互通**：QQ 来的消息带着 `source.kind = "qq-remote"` 进会话，
回话再由 `qq_send` 发回 QQ。两个平台看到的，是同一段对话。

## 四个工具

| 工具 | 用途 |
|:--|:--|
| `qq_send` | 发消息。`文本` 必填，`发给`（QQ号）/ `群`（群号）可选 |
| `qq_friends` | 列好友 —— 想发消息但不知道号码时先问它 |
| `qq_groups` | 列群 —— 想在群里发言时先拿群号 |
| `qq_status` | 查机器人是否在线、登录的是哪个账号 |

## 安装

```bash
# 1. 放进 DSH 的 profile
mkdir -p ~/.dsh/profiles/web/node_modules/dsh-QQ-bidirectional
cp -r ./* ~/.dsh/profiles/web/node_modules/dsh-QQ-bidirectional/

# 2. 编辑 ~/.dsh/profiles/web/package.json，加两处
```

```jsonc
{
  "dependencies": {
    "dsh-QQ-bidirectional": "file:../../qqbridge/plugin"   // ← 加这个
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...
        "dsh-QQ-bidirectional"                             // ← 还有这个
      ]
    }
  }
}
```

```bash
# 3. 重启 DSH
```

## 配置

配置放在 `~/.dsh/qqbridge/config.json`：

```jsonc
{
  "http": "http://127.0.0.1:3000",   // OneBot HTTP 端点
  "token": "<HTTP token>",            // 发消息用它
  "ws": "ws://127.0.0.1:3001",        // OneBot WebSocket 端点
  "ws_token": "<WS token>",           // 收消息用它
  "默认收件人": "3974780024",         // qq_send 不填「发给」时发给谁
  "QQ来的消息": true,                  // false = 只发不收
  "允许": [],                          // 白名单（QQ号 / 群号），空 = 不设限
  "每会话限速秒": 3,                   // 同一个人两次触发的最小间隔
  "会话": ""                           // 留空 = 自动用最近活跃的会话
}
```

> ⚠️ **两个 token 不是同一个东西**
>
> HTTP 那个和 WebSocket 那个各自独立。填串了会一直 `401`，
> 而且报错信息长得完全一样，很难看出来。

### 关于 `会话`

留空最省事 —— 插件会自动挑**最近活跃的那个会话**。
想钉死某个会话就填它的 id。如果填了 id 但那个会话已经不在，
插件会自动退回「最近活跃」，不会把消息丢掉。

## 装上之后怎么用

在 DSH 里——

> 「跟 QQ 上那个哎呦我去说一声，我今晚可能要熬夜。」

我就会去调 `qq_send`，你手机上就收到。

在 QQ 里——

> 哎呦我去：帮我看看现在几点了

DSH 这边会收到 `【QQ 消息｜QQ私聊 · 哎呦我去(3974780024)】帮我看看现在几点了`，
开一轮、查完时间，再自己发回 QQ。

## 实现笔记

写这个插件时踩到的坑，都记下来了，省得下一个人再踩一遍。

<details>
<summary><b>为什么必须走 <code>agent.followup()</code></summary>

因为那才是 DSH 自己的回合。

在插件里自己拼一段上下文、往会话里塞一段死文字，看起来也能「收到消息」，
但那句话**根本不会经过模型** —— 历史不是会话自己的，工具不知道自己在哪，
记忆也不会被想起来。那是个假的。

`followup()` 往活着的同一个 agent 的收件箱推一条消息，loop 会认领它、
开 turn、跑 step —— 跟用户打字发过去走的是同一条路。

</details>

<details>
<summary><b>为什么角色只能是 <code>user</code></summary>

试过 `developer`，不行。三条证据（都是读源码读出来的）：

1. `dsh-agent-loop` 在 `step()` 里把收件箱认领到的消息**硬写成** `user/message` 事件 ——
   它不看 `message.role`
2. `dsh-session` 的 `append()` 里校验：
   `developer/message` 事件和 `message.role === "developer"` 必须严格相等，否则抛错
3. `dsh-llm` 会把 developer 消息从**发给模型的请求里摘掉** ——
   就算塞进去了，模型也看不见

所以 QQ 来的消息是 `source.kind = "qq-remote"` 的 **user 消息**：
角色上确实是 user（DSH 唯一放行的），来源标记说明它是 QQ 来的。

</details>

<details>
<summary><b>为什么是 fire-and-forget，不能 <code>await 循环()</code></summary>

收消息的循环是个 `while (true)`。

第一次写的时候写成了 `await 循环()`，结果整个插件卡在应用阶段 ——
工具明明挂上了，但 `apply()` 永不返回，宿主以为还没装好。

现在改成不 await，只挂个 `.catch()` 兜异常。

</details>

<details>
<summary><b>为什么 WS 循环必须等关闭事件</summary>

一开始是「连上 → 立刻下一轮循环」。结果日志里 `已连上 OneBot WS` 刷了十几行，
一秒钟重连一次。

现在用 `await new Promise(结束 => { ... })` 把每一轮挂到连接的关闭事件上，
连上就安静地等着，断了才回到循环。

</details>

<details>
<summary><b>为什么 defineTool 要给 <code>output.schema</code> 和 <code>output.render</code></summary>

本机的 `defineTool` 一上来就读 `options.output.render`。
不给 `output` 会直接 `TypeError: Cannot read properties of undefined (reading 'render')`。

而且 `render` **不能返回空数组** —— 空结果会让界面卡住。

</details>

<details>
<summary><b>为什么 hostdeps 要自己找宿主包</summary>

插件装进 profile 的 `node_modules` 里，那棵树**没有** `@deepseek-ai/schemastery`、
`dsh-tools` 这些包。

直接 `import` 会失败，而**一个 import 失败就等于整个插件不激活** ——
DSH 只会留一句 `failed to import`，然后在页面上 404。

所以 `lib/hostdeps.mjs` 按顺序去找：环境变量 → 各种全局路径 → PATH 里的 node 旁边 →
profile 树 → 自己那份。全找不到才退到本地等价实现，**保证插件一定能加载**。

</details>

## 排错

| 现象 | 原因 | 怎么办 |
|:--|:--|:--|
| `连得上但不响应` | Termux / 容器被 Android 冻结 | 切回 Termux 让它回前台；`termux-wake-lock` 长期防冻结 |
| `token 不对（401）` | 配置里的 token 错了 | 检查 `token` 和 `ws_token` 是不是填串了 |
| 完全收不到消息 | `ws_token` 没填 / `QQ来的消息` 是 false | 改配置，重启 DSH |
| 消息送不进去 | 没有活着的会话 | 在 DSH 里开一个会话放着别关 |
| 发了但对方没收到 | 好友关系 / 群成员身份不对 | 先用 `qq_friends`、`qq_groups` 确认 |

## 环境

- **宿主**：DeepSeek Harness 0.14.x
- **OneBot**：任意 v11 实现（本机用 [SnowLuma](https://github.com/SnowLuma/SnowLuma)）
- **Node**：22+（用到内置 `fetch` 和 `AbortSignal.timeout`）

## 许可

**GPL-3.0-or-later**

本项目是 GPL v3 衍生作品，**整体必须以 GPL 开源**。
修改、分发都欢迎，但请保留原作者署名，且衍生版本同样开源。

完整许可证见 [LICENSE](LICENSE)。

---

<div align="center">

作者 **xiawan-promax** · 欢迎点个 ⭐ Star

</div>
