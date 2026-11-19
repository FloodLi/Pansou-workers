// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取，真实站点是否匹配未验证
import { describe, expect, it } from 'vitest'
import dyyj from '../../src/plugins/dyyj'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

describe('dyyj', () => {
  it('解析内联链接、提取码与时间，只请求 1 次', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/discussions', respond: fixture('dyyj/api.json') }])
    const res = await dyyj.search('流浪地球', ctx)
    expect(res).toHaveLength(1)
    const r = res[0]!
    expect(r.unique_id).toBe('dyyj-11')
    expect(r.title).toBe('流浪地球 4K')
    expect(r.datetime).toBe('2024-03-01T08:00:00Z')
    expect(r.links.map((l) => [l.type, l.url, l.password])).toEqual([
      ['quark', 'https://pan.quark.cn/s/abc123', 'ab12'],
      ['baidu', 'https://pan.baidu.com/s/xyz?pwd=wxyz', 'wxyz'],
    ])
    expectValidPluginResults(dyyj, res)
    expect(mock.calls).toHaveLength(1)
    const c = mock.calls[0]!
    expect(c.method).toBe('GET')
    const u = new URL(c.url)
    expect(u.origin).toBe('https://bbs.dyyjmax.org')
    expect(u.searchParams.get('filter[q]')).toBe('流浪地球')
    expect(u.searchParams.get('include')).toBe('mostRelevantPost')
    expect(u.searchParams.get('page[limit]')).toBe('100')
  })
  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: '/api/', respond: { data: [], included: [] } }])
    expect(await dyyj.search('x', ctx)).toEqual([])
  })
  it('HTTP 500 抛错且子请求不超过 3', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/', respond: 'err', status: 500 }])
    await expect(dyyj.search('x', ctx)).rejects.toThrow(/500/)
    expect(mock.calls.length).toBeLessThanOrEqual(3)
  })
  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: '/api/', respond: '<html>cf</html>' }])
    await expect(dyyj.search('x', ctx)).rejects.toThrow()
  })
})
