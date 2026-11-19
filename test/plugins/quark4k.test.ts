// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取，真实站点是否匹配未验证
import { describe, expect, it } from 'vitest'
import quark4k from '../../src/plugins/quark4k'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

describe('quark4k', () => {
  it('两页并发、去重、解析夸克链接与提取码', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/discussions', respond: fixture('quark4k/api.json') }])
    const res = await quark4k.search('流浪地球', ctx)
    expect(res).toHaveLength(1) // 无夸克链接/标题不含关键词的被丢弃，两页重复被去重
    const r = res[0]!
    expect(r.unique_id).toBe('quark4k-21')
    expect(r.links).toEqual([expect.objectContaining({ type: 'quark', url: 'https://pan.quark.cn/s/aaa111', password: 'k9k9' })])
    expect(r.content).toContain('&更多')
    expectValidPluginResults(quark4k, res)
    expect(mock.calls).toHaveLength(2)
    const offsets = mock.calls.map((c) => new URL(c.url).searchParams.get('page[offset]')).sort()
    expect(offsets).toEqual(['0', '50'])
    for (const c of mock.calls) {
      const u = new URL(c.url)
      expect(u.origin).toBe('https://quark4k.com')
      expect(u.searchParams.get('page[limit]')).toBe('50')
      expect(u.searchParams.get('include')).toContain('mostRelevantPost')
      expect(c.headers['x-forwarded-for']).toBeUndefined()
      expect(c.method).toBe('GET')
    }
  })
  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: '/api/', respond: { data: [], included: [] } }])
    expect(await quark4k.search('x', ctx)).toEqual([])
  })
  it('上游 500 抛错，子请求不超过 6', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/', respond: 'e', status: 500 }])
    await expect(quark4k.search('x', ctx)).rejects.toThrow(/500/)
    expect(mock.calls.length).toBeLessThanOrEqual(6)
  })
  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: '/api/', respond: 'nope' }])
    await expect(quark4k.search('x', ctx)).rejects.toThrow()
  })
})
