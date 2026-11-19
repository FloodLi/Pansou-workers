import type { Context } from 'hono'
import { loadConfig } from '../config'
import { SubrequestBudget } from '../core/budget'
import { HttpClient } from '../core/http'
import { ALL_PLUGINS } from '../plugins'
import { runPlugin } from '../plugins/run'
import type { Env } from '../types'
import { failure } from '../types'

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024

interface Captured {
  url: string
  method: string
  status: number
  contentType: string
  challenge: boolean
  truncated: boolean
  body: string
}

/** 疑似 Cloudflare/WAF 挑战页（用于判断 Worker 出口是否被目标站拦截）。 */
function looksLikeChallenge(status: number, headers: Headers, body: string): boolean {
  if (headers.get('cf-mitigated')) return true
  if (status === 403 || status === 503) {
    return /just a moment|cf-chl|challenge-platform|attention required|anubis/i.test(body)
  }
  return /<title>\s*just a moment/i.test(body)
}

/**
 * 单插件在线检查：仅当 DEBUG_ROUTES=true 时可用（生产默认关闭）。
 * 用途：在 `wrangler dev`（本机出口）或已部署的 Worker（Cloudflare 出口）上，
 * 验证目标站是否存活、是否拦截。`capture=1` 时返回上游原始响应，供 scripts/capture-fixture.mjs 保存为 fixture。
 */
export async function debugPluginHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const config = loadConfig(c.env)
  if (!config.debugRoutes) return c.json(failure(404, '接口不存在'), 404)

  const name = (c.req.param('name') ?? '').toLowerCase()
  const plugin = ALL_PLUGINS.find((p) => p.name === name)
  if (!plugin) return c.json(failure(404, `未知插件: ${name}`), 404)
  const kw = c.req.query('kw')
  if (!kw) return c.json(failure(400, '缺少 kw'), 400)
  const capture = c.req.query('capture') === '1'

  const captured: Captured[] = []
  const recordingFetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init)
    try {
      const text = await res.clone().text()
      captured.push({
        url: input,
        method: (init?.method ?? 'GET').toUpperCase(),
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        challenge: looksLikeChallenge(res.status, res.headers, text.slice(0, 4096)),
        truncated: text.length > MAX_CAPTURE_BYTES,
        body: capture ? text.slice(0, MAX_CAPTURE_BYTES) : '',
      })
    } catch {
      // 记录失败不影响插件本身
    }
    return res
  }

  const budget = new SubrequestBudget(config.subrequestBudget)
  const http = new HttpClient(budget, recordingFetch)
  const started = Date.now()
  const out = await runPlugin(plugin, kw, { http, config, budget, ext: {} })
  const elapsedMs = Date.now() - started

  return c.json({
    plugin: plugin.name,
    ok: out.ok,
    error: out.ok ? undefined : out.error,
    count: out.ok ? out.results.length : 0,
    linkCount: out.ok ? out.results.reduce((n, r) => n + r.links.length, 0) : 0,
    elapsedMs,
    subrequests: budget.usedCount,
    challengeSuspected: captured.some((r) => r.challenge),
    requests: captured.map(({ body, ...meta }) => (capture ? { ...meta, body } : meta)),
    sample: out.ok ? out.results.slice(0, 3) : [],
  })
}
