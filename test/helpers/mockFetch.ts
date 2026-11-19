import { loadConfig, type AppConfig } from '../../src/config'
import { SubrequestBudget } from '../../src/core/budget'
import { HttpClient } from '../../src/core/http'
import type { PluginContext } from '../../src/plugins/types'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface MockCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

export type MockResponder = string | object | Response | ((call: MockCall) => string | object | Response)

export interface MockRoute {
  /** 字符串表示 URL 包含该片段；正则匹配完整 URL；函数自定义 */
  match: string | RegExp | ((call: MockCall) => boolean)
  method?: string
  respond: MockResponder
  /** 状态码，仅当 respond 不是 Response 时使用 */
  status?: number
  headers?: Record<string, string>
}

export interface Mock {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  calls: MockCall[]
}

/** 按路由表回放响应；未命中的请求抛错，避免测试意外依赖网络。 */
export function mockFetch(routes: MockRoute[]): Mock {
  const calls: MockCall[] = []
  const fetchFn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => (headers[k] = v))
    const body = init.body === undefined || init.body === null ? '' : String(init.body)
    const call: MockCall = { url: String(input), method: (init.method ?? 'GET').toUpperCase(), headers, body }
    calls.push(call)
    for (const r of routes) {
      if (r.method && r.method.toUpperCase() !== call.method) continue
      const hit =
        typeof r.match === 'string'
          ? call.url.includes(r.match)
          : r.match instanceof RegExp
            ? r.match.test(call.url)
            : r.match(call)
      if (!hit) continue
      const out = typeof r.respond === 'function' ? r.respond(call) : r.respond
      if (out instanceof Response) return out
      const isStr = typeof out === 'string'
      return new Response(isStr ? out : JSON.stringify(out), {
        status: r.status ?? 200,
        headers: { 'content-type': isStr ? 'text/html; charset=utf-8' : 'application/json', ...r.headers },
      })
    }
    throw new Error(`mockFetch: 未匹配的请求 ${call.method} ${call.url}`)
  }
  return { fetch: fetchFn, calls }
}

export interface TestCtx {
  ctx: PluginContext
  mock: Mock
  budget: SubrequestBudget
}

export function makeCtx(routes: MockRoute[], opts: { ext?: Record<string, unknown>; budget?: number; config?: Partial<AppConfig> } = {}): TestCtx {
  const mock = mockFetch(routes)
  const budget = new SubrequestBudget(opts.budget ?? 45)
  const config = { ...loadConfig({}), ...opts.config }
  const ctx: PluginContext = {
    http: new HttpClient(budget, mock.fetch),
    ext: opts.ext ?? {},
    signal: new AbortController().signal,
    config,
  }
  return { ctx, mock, budget }
}

const here = dirname(fileURLToPath(import.meta.url))

/** 读取 test/fixtures 下的文件内容。 */
export function fixture(path: string): string {
  return readFileSync(join(here, '..', 'fixtures', path), 'utf-8')
}
