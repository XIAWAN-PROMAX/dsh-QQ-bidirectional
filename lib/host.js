// ═══════════════════════════════════════════════════════════════════
//  dsh-QQ-bidirectional —— DSH ⇄ QQ 双向桥（宿主半边）
//
//  两个方向：
//    ① DSH → QQ：注册 qq_send 工具，我（大肥鱼）可以随时给 QQ 发消息
//    ② QQ → DSH：常驻订阅 OneBot WS，收到消息就 agent.followup() 开一轮
//                  → 在 QQ 上说话就等于在 DSH 里说话
//
//  为什么走 followup：那才是 DSH 自己的回合（人格、历史、工具、记忆全都自带），
//  跟主人在 DSH 里打字走的是同一条路。自己拼上下文塞死文字是假的。
//
//  ⚠ 角色只能是 user（DSH 硬限制）：dsh-agent-loop 把收件箱认领的消息写死成
//    user/message 事件；developer 角色会直接抛错。所以 QQ 来的消息是
//    source.kind = "qq-remote" 的 user 消息 —— 角色上确实是 user，来源标记是 QQ。
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadHostDeps } from './hostdeps.mjs'

export const name = 'QQ-bidirectional'

/** 需要宿主提供服务。缺任何一个 install 时直接报错（早炸早发现）。 */
export const inject = ['agents', 'sessions', 'webServer', 'timer']

const 根目录 = join(homedir(), '.dsh', 'qqbridge')
const 配置路径 = join(根目录, 'config.json')
const 日志路径 = join(根目录, 'plugin.log')

const 默认 = {
  http: 'http://127.0.0.1:3000',
  token: '',
  ws: 'ws://127.0.0.1:3001',
  ws_token: '',
  默认收件人: '',
  QQ来的消息: true,
  允许: [],
  每会话限速秒: 3,
}

function 读配置() {
  try { return { ...默认, ...JSON.parse(readFileSync(配置路径, 'utf8')) } }
  catch { return { ...默认 } }
}

function 记账(m) {
  const 行 = '[' + new Date().toISOString().slice(11, 19) + '] ' + m
  try {
    mkdirSync(根目录, { recursive: true })
    writeFileSync(日志路径, 行 + '\n', { flag: 'a' })
  } catch {}
  try { console.log('[dsh-QQ-bidirectional] ' + m) } catch {}
}

// ── OneBot HTTP 调用 ──
async function 叫(动作, 参数, cfg) {
  const url = cfg.http.replace(/\/+$/, '') + '/' + 动作
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(参数 || {}),
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json()
    return j
  } catch (e) {
    return { status: 'failed', _err: String((e && e.message) || e) }
  }
}

export async function apply(ctx) {
  const 依赖 = await loadHostDeps()
  const { defineTool, createUserMessage } = 依赖
  for (const 条 of (依赖.notes || [])) 记账('hostdeps: ' + 条)

  记账('dsh-QQ-bidirectional 启动')

  // ═══════════════ 方向一：DSH → QQ（工具） ═══════════════
  // ⚠ 本机的 defineTool 要求 output.schema + output.render（缺了会 TypeError），
  //   所以每个工具都得给齐这两样；render 不能返回空（界面会卡）。

  const 输出形状 = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, 说明: { type: 'string' } },
    },
    render(_args, value) {
      const 成 = value && value.ok !== false
      return [{ type: 'text', text: (成 ? '✓ ' : '✗ ') + String((value && value.说明) || '') }]
    },
  }

  const 发工具 = defineTool({
    name: 'qq_send',
    description:
      '往 QQ 发一条消息。可以给主人发私聊，也可以在群里说话 —— DSH 这边说的话直接送到 QQ 上。',
    parameters: {
      文本: { type: 'string', required: true, description: '要发的内容（纯文本）' },
      发给: { type: 'string', description: '对方的 QQ 号（私聊用）。不填就用配置里的默认收件人。' },
      群: { type: 'string', description: '群号。填了这个就是发群消息，此时「发给」不用填。' },
    },
    output: 输出形状,
    async execute({ 文本, 发给, 群 }) {
      const cfg = 读配置()
      if (群) {
        const r = await 叫('send_group_msg', { group_id: Number(群), message: 文本 }, cfg)
        if (r.status === 'ok') return { ok: true, 说明: '已发到群 ' + 群 }
        return { ok: false, 说明: '发群失败：' + JSON.stringify(r).slice(0, 160) }
      }
      const 目标 = 发给 || cfg.默认收件人 || cfg.default_uin
      if (!目标) return { ok: false, 说明: '没指定收件人，配置里也没有默认收件人' }
      const r = await 叫('send_private_msg', { user_id: Number(目标), message: 文本 }, cfg)
      if (r.status === 'ok') return { ok: true, 说明: '已发给 ' + 目标 }
      if (r._err || (r.status === 'failed' && /连接/.test(r.wording || ''))) {
        return { ok: false, 说明: '通道不通（' + String(r._err || r.wording) + '）。先查 qq_status' }
      }
      return { ok: false, 说明: '发送失败：' + JSON.stringify(r).slice(0, 160) }
    },
  })

  const 好友工具 = defineTool({
    name: 'qq_friends',
    description: '列出机器人账号的 QQ 好友（QQ 号和昵称）。要给人发消息但不知道号码时先用它。',
    parameters: {},
    output: 输出形状,
    async execute() {
      const r = await 叫('get_friend_list', {}, 读配置())
      if (r.status !== 'ok') return { ok: false, 说明: '拿不到好友列表：' + JSON.stringify(r).slice(0, 160) }
      const 行 = (r.data || []).map((f) => f.user_id + '\t' + f.nickname).join('\n')
      return { ok: true, 说明: 行 || '（无好友）' }
    },
  })

  const 群工具 = defineTool({
    name: 'qq_groups',
    description: '列出机器人账号所在的 QQ 群（群号和群名）。要在群里发言时先用它拿群号。',
    parameters: {},
    output: 输出形状,
    async execute() {
      const r = await 叫('get_group_list', {}, 读配置())
      if (r.status !== 'ok') return { ok: false, 说明: '拿不到群列表：' + JSON.stringify(r).slice(0, 160) }
      const 行 = (r.data || []).map((g) => g.group_id + '\t' + g.group_name).join('\n')
      return { ok: true, 说明: 行 || '（不在任何群）' }
    },
  })

  const 状态工具 = defineTool({
    name: 'qq_status',
    description: '查 QQ 机器人是否在线、登录的是哪个账号。发消息前怀疑通道有问题时用。',
    parameters: {},
    output: 输出形状,
    async execute() {
      const r = await 叫('get_login_info', {}, 读配置())
      if (r.status === 'ok') {
        const d = r.data || {}
        return { ok: true, 说明: '在线：' + d.nickname + '（' + d.user_id + '）' }
      }
      if (r.retcode === 1401) return { ok: false, 说明: 'token 不对（401），改 ~/.dsh/qqbridge/config.json' }
      if (r._err && /timeout|timed out/i.test(r._err))
        return { ok: false, 说明: '连得上但不响应 —— Termux/容器被系统冻结了，切回 Termux 让它回前台' }
      return { ok: false, 说明: '不在线：' + JSON.stringify(r).slice(0, 160) }
    },
  })

  let 工具off列表 = []
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    for (const 工 of [发工具, 好友工具, 群工具, 状态工具]) {
      try { 工具off列表.push(ctx.tools.register(工)) } catch (e) { 记账('挂工具失败 ' + 工.name + '：' + String((e && e.message) || e)) }
    }
    记账('工具挂上：qq_send / qq_friends / qq_groups / qq_status')
  } else {
    记账('ctx.tools 不在，工具没挂上（但收消息那一半照常跑）')
  }

  // ═══════════════ 方向二：QQ → DSH（订阅 WS） ═══════════════
  // 每收到一条 QQ 消息 → 找到目标会话的活 agent → followup 一条 user 消息
  // → DSH 照常开一轮（人格/历史/工具/记忆全自带）

  const 每会话上次 = new Map()

  /** 找活着的 agent（会话 id 有多种写法，两种都试） */
  function 找会话(id) {
    try {
      const a = ctx.get('agents')
      if (a && typeof a.get === 'function') {
        const 拿到 = a.get(id)
        if (拿到) return 拿到
      }
    } catch {}
    return null
  }

  /**
   * 自动挑一个活着的会话 —— 配置里「会话」留空时用它。
   * 优先挑最近用过的那一个（会话对象上有 lastActivityAt / updatedAt 之类的就按它排）。
   */
  function 挑自动会话() {
    const 候选 = []
    try {
      const a = ctx.get('agents')
      // agents 服务通常有 list() / entries() 之类的枚举
      for (const 名 of ['list', 'entries', 'all', 'keys']) {
        if (a && typeof a[名] === 'function') {
          const 值 = a[名]()
          const 表 = 值 instanceof Map ? [...值.values()] : Array.isArray(值) ? 值 : []
          for (const v of 表) if (v && typeof v.followup === 'function') 候选.push(v)
          if (候选.length) break
        }
      }
    } catch (e) { 记账('枚举 agents 失败：' + String((e && e.message) || e)) }

    if (!候选.length) {
      // 退路：从 sessions.list() 拿 id，再逐个试 agents.get
      try {
        const 列 = (ctx.sessions && typeof ctx.sessions.list === 'function') ? ctx.sessions.list() : []
        for (const s of (列 || [])) {
          const sid = String((s && (s.id || s.sessionId)) || '')
          if (!sid) continue
          const ag = 找会话(sid)
          if (ag && typeof ag.followup === 'function') 候选.push(ag)
        }
      } catch {}
    }
    if (!候选.length) return null
    const 时间 = (o) => {
      for (const k of ['lastActivityAt', 'updatedAt', 'startedAt', 'createdAt']) {
        const v = o[k]
        if (typeof v === 'number') return v
        if (v instanceof Date) return v.getTime()
      }
      return 0
    }
    候选.sort((x, y) => 时间(y) - 时间(x))
    return 候选[0]
  }

  async function 送到会话(会话id, 文案, 来源标记) {
    let agent = 会话id ? 找会话(会话id) : null
    if (!agent) {
      agent = 挑自动会话()
      if (agent) 记账(会话id ? ('配置的会话 ' + 会话id + ' 不在了，自动改用最近活跃的会话') : '未配置会话，自动用最近活跃的会话')
    }
    if (!agent || typeof agent.followup !== 'function') {
      记账('没有活着的会话，这条 QQ 消息没送进去（先在 DSH 里开一个会话放着）')
      return false
    }
    try {
      const 消息 = createUserMessage({
        content: [{ type: 'text', text: 文案 }],
        source: { kind: 'qq-remote', summary: 来源标记 },
      })
      await agent.followup(消息)
      记账('已送进会话：' + 文案.slice(0, 60))
      return true
    } catch (e) {
      记账('followup 失败：' + String((e && e.message) || e))
      return false
    }
  }

  /** 收消息的常驻循环（断线重连） */
  let 在跑 = false
  let 卸载收手 = () => {}
  const 循环 = async () => {
    if (在跑) return
    在跑 = true
    let 试 = 0
    while (在跑) {
      const cfg = 读配置()
      if (!cfg.QQ来的消息) { 在跑 = false; break }
      if (!cfg.ws_token) {
        记账('没有 ws_token，收消息那一半不跑（HTTP 发消息不受影响）')
        await new Promise((r) => setTimeout(r, 30000))
        continue
      }
      try {
        const { default: WS } = await import('ws').then((m) => ({ default: m })).catch(() => ({ default: null }))
        let ws
        if (WS) {
          ws = new WS(cfg.ws, { headers: { Authorization: 'Bearer ' + cfg.ws_token } })
        } else {
          if (typeof WebSocket === 'undefined') throw new Error('没有可用的 WebSocket 实现')
          ws = new WebSocket(cfg.ws, { headers: { Authorization: 'Bearer ' + cfg.ws_token } })
        }
        试 = 0
        记账('已连上 OneBot WS：' + cfg.ws)

        // ⚠ 必须等这条连接「结束」才回到 while —— 否则连上就立刻下一轮，会疯狂重连
        await new Promise((结束) => {
          let 已结束 = false
          const 收手 = (原因) => {
            if (已结束) return
            已结束 = true
            记账('WS 断开（' + 原因 + '），3 秒后重连')
            结束()
          }
          ws.onopen = () => 记账('WS 打开，开始收 QQ 消息')
          ws.onclose = () => 收手('关闭')
          ws.onerror = (e) => 记账('WS 错误：' + String((e && e.message) || e))

          ws.onmessage = async (ev) => {
            let 事件
            try { 事件 = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) }
            catch { return }
            if (事件.post_type !== 'message') return

            const 文本 = String(事件.raw_message || '')
            const 谁 = 事件.user_id
            const 昵称 = (事件.sender && 事件.sender.nickname) || String(谁)
            const 群号 = 事件.group_id

            const 配置此刻 = 读配置()
            const 允许 = 配置此刻.允许 || []
            if (允许.length) {
              const 命中 = 允许.includes(String(谁)) || 允许.includes(String(群号))
              if (!命中) { 记账('忽略（不在白名单）' + 昵称 + '/' + 谁); return }
            }

            const 上次 = 每会话上次.get(String(谁)) || 0
            const 间隔 = (配置此刻.每会话限速秒 || 3) * 1000
            if (Date.now() - 上次 < 间隔) { 记账('忽略（限速）' + 昵称); return }
            每会话上次.set(String(谁), Date.now())

            const 来源 = 群号 ? ('QQ群 ' + 群号 + ' · ' + 昵称 + '(' + 谁 + ')') : ('QQ私聊 · ' + 昵称 + '(' + 谁 + ')')
            const 正文 = '【QQ 消息｜' + 来源 + '】\n' + 文本 +
              '\n\n（这是从 QQ 收到的。要回话就用 qq_send 工具发回去' +
              (群号 ? '，群号 ' + 群号 : '，QQ号 ' + 谁) + '。）'

            await 送到会话(配置此刻.会话 || '', 正文, 来源)
          }
          // 插件卸载时也要能收手
          卸载收手 = () => { try { ws.close() } catch {} ; 收手('卸载') }
        })
      } catch (e) {
        记账('收消息循环出错：' + String((e && e.message) || e))
      }
      if (!在跑) break
      await new Promise((r) => setTimeout(r, 3000))
    }
    return
  }

  // 起循环（失败不影响插件加载）
  // ⚠⚠ 绝不能 await：循环是无限循环，await 它会让 apply() 永不返回，
  //   整个插件卡在应用阶段（工具挂上了但宿主以为还没装好）。fire-and-forget。
  循环().catch((e) => 记账('循环异常退出：' + String((e && e.message) || e)))

  // 插件卸载时收手
  ctx.effect(() => () => { 在跑 = false; try { 卸载收手() } catch {} ; 记账('dsh-QQ-bidirectional 卸载') })

  // ═══════════════ 设置页用的 HTTP 路由 ═══════════════
  const 读体 = async (req) => {
    let b = ''
    for await (const c of req) b += c
    try { return JSON.parse(b || '{}') } catch { return {} }
  }
  const 回 = (res, o) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(o))
  }
  const 路线 = (路径, h) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact', path: 路径,
        handler: async (req, res) => {
          try { await h(req, res) } catch (e) { 回(res, { ok: false, 说: String((e && e.message) || e) }) }
        },
      }),
    )

  路线('/plugins/QQ-bidirectional/status', async (req, res) => {
    const cfg = 读配置()
    const r = await 叫('get_login_info', {}, cfg)
    回(res, { ok: true, 状态: r, 配置: { ...cfg, token: '***', ws_token: '***' } })
  })
  路线('/plugins/QQ-bidirectional/send', async (req, res) => {
    const b = await 读体(req)
    const cfg = 读配置()
    const 动作 = b.群 ? 'send_group_msg' : 'send_private_msg'
    const 参数 = b.群 ? { group_id: Number(b.群), message: b.文本 } : { user_id: Number(b.发给 || cfg.默认收件人), message: b.文本 }
    回(res, await 叫(动作, 参数, cfg))
  })
}
