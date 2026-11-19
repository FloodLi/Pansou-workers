// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/quarkres'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'squark.cc.cd/api/search', respond: () => fixture('quarkres/search.json') }

describe('quarkres', () => {
  it('只保留夸克链接并解析字段', async () => {
    const { ctx } = makeCtx([route])
    const results = await plugin.search('夸克', ctx)
    expectValidPluginResults(plugin, results)
    expect(results.map((r) => r.unique_id)).toEqual(['quarkres-quark_res-1001', 'quarkres-1002'])
    const r = results[0]!
    expect(r.title).toBe('夸克片A')
    expect(r.datetime).toBe('2025-03-01T08:00:00Z')
    expect(r.links).toEqual([{ type: 'quark', url: 'https://pan.quark.cn/s/aaa111', password: 'pw01', datetime: '2025-03-01T08:00:00Z' }])
  })

  it('请求形态：GET + Referer，单次子请求', async () => {
    const { ctx, mock } = makeCtx([route])
    await plugin.search('a b', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://squark.cc.cd/api/search?kw=a%20b')
    expect(mock.calls[0]!.headers.referer).toBe('https://squark.cc.cd/')
  })

  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: 'squark', respond: { code: 200, data: [] } }])
    expect(await plugin.search('x', ctx)).toEqual([])
  })

  it('code!==200 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'squark', respond: { code: 500, message: 'boom' } }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('boom')
  })

  it('HTTP 500 抛错且仅 1 次子请求', async () => {
    const { ctx, mock } = makeCtx([{ match: 'squark', respond: 'err', status: 500 }])
    await expect(plugin.search('x', ctx)).rejects.toThrow()
    expect(mock.calls).toHaveLength(1)
  })

  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'squark', respond: 'nope' }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('JSON')
  })
})
