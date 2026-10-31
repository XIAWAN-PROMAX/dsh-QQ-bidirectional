/**
 * 从宿主那棵树里取 @deepseek-ai/*（拿不到就退到 bare import，再拿不到就本地等价）
 * 目的：绝不因为一个 import 失败就让整个插件不激活。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)
  const appdata = process.env.APPDATA
  if (appdata) push(join(appdata, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  // Android / Termux 类前缀：按 PATH 里 node 的位置往上找
  try {
    const seen = new Set()
    for (const p of (process.env.PATH || '').split(':')) {
      if (!p || seen.has(p)) continue
      seen.add(p)
      push(join(p, '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
    }
  } catch {}
  // 本机实测路径（DSH 自带的 usr 快照）
  push('/data/data/com.dsharnessmobile.shell/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch {}
  push(SELF_MODULES)
  return out
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const exp = pkg.exports && pkg.exports['.']
    let rel = null
    if (typeof exp === 'string') rel = exp
    else if (exp && typeof exp === 'object') rel = exp.import || exp.default || exp.require
    if (!rel) rel = pkg.main
    if (!rel) return null
    const file = join(dir, rel)
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

async function tryLoad(name) {
  for (const root of candidateRoots()) {
    const url = entryUrlFor(root, name)
    if (!url) continue
    try { return await import(url) } catch {}
  }
  try { return await import(name) } catch {}
  return null
}

export async function loadHostDeps() {
  const notes = []
  let tools = await tryLoad('dsh-tools')
  let msg = await tryLoad('dsh-llm')
  let defineTool = tools && (tools.defineTool || (tools.default && tools.default.defineTool))
  let createUserMessage = msg && (msg.createUserMessage || (msg.default && msg.default.createUserMessage))
  if (!defineTool) { notes.push('defineTool 拿不到，用本地等价'); defineTool = localDefineTool }
  if (!createUserMessage) { notes.push('createUserMessage 拿不到，用本地等价'); createUserMessage = localCreateUserMessage }
  return { defineTool, createUserMessage, notes }
}

/** 本地等价：只要 DSH 认这个形状就行 */
function localDefineTool(spec) { return spec }

function localCreateUserMessage(args) {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2),
    role: 'user',
    content: args.content,
    source: args.source || { kind: 'qq-remote' },
    createdAt: new Date().toISOString(),
  }
}
