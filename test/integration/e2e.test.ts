import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/index'
import type { Env } from '../../src/types'
import { fixture } from '../helpers/mockFetch'

// 端到端：TG 频道 + 插件 + 缓存。全部上游用 fixture 回放，不访问网络。
// TG 页面是 Go 仓库里真实抓取的，插件响应是合成数据。

function stubUpstream() {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://t.me/s/')) {
      return new Response(fixture('tg/tg_channel_shareAliyun_real.html'), { headers: { 'content-type': 'text/html' } })
    }
    if (url.includes('squark.cc.cd')) {
      return new Response(fixture('quarkres/search.json'), { headers: { 'content-type': 'application/json' } })
    }
    throw new Error('unexpected fetch ' + url)
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

const env = (over: Partial<Env> = {}): Env => ({
  ENABLED_PLUGINS: 'quarkres',
  CHANNELS: 'shareAliyun',
  ASYNC_RESPONSE_TIMEOUT: '2',
  ...over,
})

type Body = { code: number; data: { total: number; results?: { channel: string; unique_id: string }[]; merged_by_type?: Record<string, { source?: string }[]> } }

describe('端到端', () => {
  it('src=all：同时返回 TG 与插件结果；第二次查询命中缓存不再出站', async () => {
    const calls = stubUpstream()
    const e = env()
    const url = '/api/search?kw=%E5%A4%B8%E5%85%8B&src=all&res=all&refresh=true'
    const first = (await (await app.request(url, undefined, e)).json()) as Body
    expect(first.code).toBe(0)
    const sources = new Set((first.data.results ?? []).map((r) => (r.channel ? `tg:${r.channel}` : 'plugin')))
    expect(sources.has('tg:shareAliyun')).toBe(true)
    expect(sources.has('plugin')).toBe(true)
    expect(calls.filter((u) => u.startsWith('https://t.me/s/')).length).toBe(1)
    expect(calls.filter((u) => u.includes('squark.cc.cd')).length).toBe(1)
    // 插件结果只保留夸克链接
    expect(first.data.merged_by_type?.quark?.some((l) => l.source === 'plugin:quarkres')).toBe(true)
  })

  it('同一关键词再次查询（不带 refresh）命中缓存，零出站', async () => {
    const calls = stubUpstream()
    const e = env()
    const kw = encodeURIComponent('缓存测试' + Math.random())
    await app.request(`/api/search?kw=${kw}&src=all&res=all`, undefined, e)
    // 等待后台写缓存（无 ExecutionContext 时路由已 await）
    const before = calls.length
    const second = (await (await app.request(`/api/search?kw=${kw}&src=all&res=all`, undefined, e)).json()) as Body
    expect(calls.length).toBe(before)
    expect(second.code).toBe(0)
  })

  it('某个来源失败不影响其他来源', async () => {
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input)
      if (url.startsWith('https://t.me/s/')) return new Response('bad', { status: 500 })
      return new Response(fixture('quarkres/search.json'), { headers: { 'content-type': 'application/json' } })
    })
    const body = (await (await app.request('/api/search?kw=x&src=all&res=all&refresh=true', undefined, env())).json()) as Body
    expect(body.code).toBe(0)
    expect(body.data.results?.some((r) => r.unique_id.startsWith('quarkres-'))).toBe(true)
  })
})
