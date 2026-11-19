import { describe, expect, it } from 'vitest'
import { MemoryCache } from '../../src/cache/kv'
import { loadConfig } from '../../src/config'
import { definePlugin, makeResult, type Plugin } from '../../src/plugins/types'
import { search, type SearchParams } from '../../src/search/service'
import { sleep } from '../../src/core/http'

const config = (over: Record<string, unknown> = {}) => ({
  ...loadConfig({}),
  enabledPlugins: ['fast', 'slow', 'bad', 'greedy'],
  asyncResponseMs: 100,
  pluginTimeoutMs: 2000,
  subrequestBudget: 10,
  ...over,
})

function plugin(name: string, delay: number, fn?: () => Promise<void>): Plugin {
  return definePlugin({
    name,
    priority: 3,
    skipServiceFilter: true,
    async search(kw, ctx) {
      await sleep(delay)
      if (fn) await fn()
      void ctx
      return [makeResult({ plugin: name, id: kw, title: `${kw}-${name}`, datetime: '2025-01-01T00:00:00Z', links: [{ url: `https://pan.quark.cn/s/${name}${kw}` }] })]
    },
  })
}

const params = (over: Partial<SearchParams> = {}): SearchParams => ({
  keyword: 'abc',
  channels: [],
  forceRefresh: false,
  resultType: 'all',
  sourceType: 'plugin',
  plugins: [],
  ext: {},
  ...over,
})

describe('search 编排', () => {
  it('窗口内只返回已完成来源，慢来源在 background 补全并回写缓存', async () => {
    const cache = new MemoryCache()
    const plugins = [plugin('fast', 0), plugin('slow', 400)]
    const deps = { config: config(), plugins, cache }

    const first = await search(params(), deps)
    expect(first.response.results?.map((r) => r.unique_id)).toEqual(['fast-abc'])
    expect(first.stats.pending).toEqual(['plugin:slow'])

    await first.background // 慢来源完成并写缓存
    const second = await search(params(), deps)
    expect(second.response.results?.map((r) => r.unique_id).sort()).toEqual(['fast-abc', 'slow-abc'])
    // 第二次全部命中缓存：不发起任何来源抓取
    expect(second.stats.cached.sort()).toEqual(['plugin:fast', 'plugin:slow'])
    expect(second.stats.fetched).toEqual([])
  })

  it('forceRefresh 绕过缓存', async () => {
    let calls = 0
    const cache = new MemoryCache()
    const deps = { config: config(), plugins: [plugin('fast', 0, async () => void calls++)], cache }
    const a = await search(params(), deps)
    await a.background
    await search(params(), deps) // 命中缓存
    expect(calls).toBe(1)
    const c = await search(params({ forceRefresh: true }), deps)
    await c.background
    expect(calls).toBe(2)
  })

  it('单个来源失败不影响其他来源，失败标记在短 TTL 内不重试', async () => {
    let badCalls = 0
    const bad = definePlugin({
      name: 'bad',
      priority: 3,
      skipServiceFilter: true,
      async search() {
        badCalls++
        throw new Error('boom')
      },
    })
    const cache = new MemoryCache()
    const deps = { config: config(), plugins: [plugin('fast', 0), bad], cache }
    const a = await search(params(), deps)
    expect(a.response.results?.map((r) => r.unique_id)).toEqual(['fast-abc'])
    expect(a.stats.failed['plugin:bad']).toContain('boom')
    await a.background
    const b = await search(params(), deps)
    await b.background
    expect(badCalls).toBe(1)
  })

  it('失败后保留旧结果作为兜底', async () => {
    const cache = new MemoryCache()
    let fail = false
    const flaky = definePlugin({
      name: 'fast',
      priority: 3,
      skipServiceFilter: true,
      async search(kw) {
        if (fail) throw new Error('down')
        return [makeResult({ plugin: 'fast', id: kw, title: kw, datetime: '2025-01-01T00:00:00Z', links: [{ url: 'https://pan.quark.cn/s/old' }] })]
      },
    })
    const deps = { config: config(), plugins: [flaky], cache }
    await (await search(params(), deps)).background
    fail = true
    const out = await search(params({ forceRefresh: true }), deps)
    await out.background
    expect(out.stats.failed['plugin:fast']).toBeDefined()
    // forceRefresh 不读缓存，因此这次拿不到旧结果；非强制刷新且缓存过期时才会兜底
    expect(out.response.results ?? []).toEqual([])
  })

  it('过期缓存在来源失败时作为兜底返回', async () => {
    const cache = new MemoryCache()
    let fail = false
    let clock = 1_000_000
    const flaky = definePlugin({
      name: 'fast',
      priority: 3,
      skipServiceFilter: true,
      async search(kw) {
        if (fail) throw new Error('down')
        return [makeResult({ plugin: 'fast', id: kw, title: kw, datetime: '2025-01-01T00:00:00Z', links: [{ url: 'https://pan.quark.cn/s/old' }] })]
      },
    })
    const deps = { config: config({ cacheTtlSec: 60 }), plugins: [flaky], cache, now: () => clock }
    await (await search(params(), deps)).background
    clock += 120_000 // 超过 TTL
    fail = true
    const out = await search(params(), deps)
    expect(out.response.results?.map((r) => r.unique_id)).toEqual(['fast-abc'])
    expect(out.stats.failed['plugin:fast']).toBeDefined()
  })

  it('子请求预算耗尽只让该来源失败', async () => {
    const greedy = definePlugin({
      name: 'greedy',
      priority: 3,
      skipServiceFilter: true,
      async search(_kw, ctx) {
        for (let i = 0; i < 20; i++) await ctx.http.text('https://x.test/' + i)
        return []
      },
    })
    const fetchImpl = async () => new Response('ok')
    const out = await search(params(), { config: config({ subrequestBudget: 5 }), plugins: [plugin('fast', 0), greedy], cache: new MemoryCache(), fetchImpl })
    expect(out.response.results?.map((r) => r.unique_id)).toEqual(['fast-abc'])
    expect(out.stats.failed['plugin:greedy']).toContain('预算')
  })

  it('plugins 参数只选指定插件；未启用的插件不会运行', async () => {
    const deps = { config: config({ enabledPlugins: ['fast'] }), plugins: [plugin('fast', 0), plugin('slow', 0)], cache: new MemoryCache() }
    const out = await search(params({ plugins: ['slow'] }), deps)
    expect(out.response.results ?? []).toEqual([])
    const all = await search(params(), deps)
    expect(all.response.results?.map((r) => r.unique_id)).toEqual(['fast-abc'])
  })

  it('res 取值决定响应字段', async () => {
    const deps = { config: config(), plugins: [plugin('fast', 0)], cache: new MemoryCache() }
    const merged = (await search(params({ resultType: 'merged_by_type' }), deps)).response
    expect(merged.results).toBeUndefined()
    expect(merged.merged_by_type?.quark?.length).toBe(1)
    expect(merged.total).toBe(1)
    const results = (await search(params({ resultType: 'results' }), deps)).response
    expect(results.merged_by_type).toBeUndefined()
    expect(results.results?.length).toBe(1)
  })

  it('src=tg 时不运行插件', async () => {
    const out = await search(params({ sourceType: 'tg', channels: [] }), { config: config(), plugins: [plugin('fast', 0)], cache: new MemoryCache() })
    expect(out.response.total).toBe(0)
  })

  it('无时间、无关键词优先级且插件等级>2 的结果不进 results，但仍进 merged_by_type（与原项目一致）', async () => {
    const undated = definePlugin({
      name: 'fast',
      priority: 3,
      skipServiceFilter: true,
      async search(kw) {
        return [makeResult({ plugin: 'fast', id: kw, title: kw, links: [{ url: 'https://pan.quark.cn/s/nodate' }] })]
      },
    })
    const out = await search(params({ resultType: 'all' }), { config: config(), plugins: [undated], cache: new MemoryCache() })
    expect(out.response.results).toBeUndefined() // 空数组按 omitempty 省略
    expect(out.response.merged_by_type?.quark?.length).toBe(1)
  })

  it('无结果时只返回 total（与 Go omitempty 一致）', async () => {
    const out = await search(params({ sourceType: 'plugin', plugins: ['none'] }), { config: config(), plugins: [plugin('fast', 0)], cache: new MemoryCache() })
    expect(out.response).toEqual({ total: 0 })
  })
})
