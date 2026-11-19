import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config'
import { SubrequestBudget } from '../../src/core/budget'
import { HttpClient, sleep } from '../../src/core/http'
import { normalizeResults, runPlugin } from '../../src/plugins/run'
import { definePlugin, makeResult } from '../../src/plugins/types'
import { ZERO_TIME, type SearchResult } from '../../src/types'
import { mockFetch } from '../helpers/mockFetch'

const deps = (over: Record<string, unknown> = {}) => {
  const budget = new SubrequestBudget(5)
  return { http: new HttpClient(budget, mockFetch([]).fetch), config: { ...loadConfig({}), ...over }, budget, ext: {} }
}
const base = { skipServiceFilter: false, priority: 3 as const }

describe('runPlugin', () => {
  it('成功时返回规范化结果', async () => {
    const p = definePlugin({ ...base, name: 'p', async search() { return [makeResult({ plugin: 'p', id: '1', title: 't', links: [{ url: 'https://pan.quark.cn/s/a' }] })] } })
    const out = await runPlugin(p, 'k', deps())
    expect(out.ok && out.results[0]?.unique_id).toBe('p-1')
  })

  it('抛错被隔离，返回 ok=false', async () => {
    const p = definePlugin({ ...base, name: 'p', async search() { throw new Error('boom') } })
    const out = await runPlugin(p, 'k', deps())
    expect(out).toMatchObject({ ok: false, error: 'boom', budgetExceeded: false })
  })

  it('超时返回 ok=false 且不会一直挂起', async () => {
    const p = definePlugin({ ...base, name: 'slow', async search() { await sleep(500); return [] } })
    const t0 = Date.now()
    const out = await runPlugin(p, 'k', deps({ pluginTimeoutMs: 50 }))
    expect(Date.now() - t0).toBeLessThan(400)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toContain('超时')
  })

  it('预算耗尽被标记', async () => {
    const p = definePlugin({ ...base, name: 'p', async search(_k, ctx) { for (let i = 0; i < 9; i++) await ctx.http.request('https://x.test/') ; return [] } })
    const d = deps()
    d.http = new HttpClient(d.budget, mockFetch([{ match: 'x.test', respond: 'ok' }]).fetch)
    const out = await runPlugin(p, 'k', d)
    expect(out).toMatchObject({ ok: false, budgetExceeded: true })
  })

  it('错误信息带插件名前缀（来自 ctx.http 的 tag）', async () => {
    const p = definePlugin({ ...base, name: 'demo', async search(_k, ctx) { await ctx.http.text('https://x.test/'); return [] } })
    const d = deps()
    d.http = new HttpClient(d.budget, mockFetch([{ match: 'x.test', respond: 'no', status: 404 }]).fetch)
    const out = await runPlugin(p, 'k', d)
    expect(!out.ok && out.error).toContain('[demo]')
  })
})

describe('normalizeResults', () => {
  const p = definePlugin({ ...base, name: 'p', async search() { return [] } })
  const r = (over: Partial<SearchResult>): SearchResult => ({ message_id: '', unique_id: 'p-1', channel: 'oops', datetime: ZERO_TIME, title: 't', content: '', links: [{ type: '', url: 'https://pan.baidu.com/s/x', password: '', datetime: ZERO_TIME }], ...over })

  it('强制 channel 为空、补 unique_id 前缀、补链接类型', () => {
    const out = normalizeResults(p, [r({ unique_id: '9' })])
    expect(out[0]).toMatchObject({ channel: '', unique_id: 'p-9' })
    expect(out[0]?.links[0]?.type).toBe('baidu')
  })
  it('丢弃没有有效链接的结果', () => {
    expect(normalizeResults(p, [r({ links: [] }), r({ links: [{ type: 'x', url: '', password: '', datetime: ZERO_TIME }] })])).toEqual([])
  })
})
