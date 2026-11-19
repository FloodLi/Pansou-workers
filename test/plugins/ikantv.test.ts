// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/ikantv'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'api.naspt.vip/api/open/pansou/search', respond: () => fixture('ikantv/search.json') }

describe('ikantv', () => {
  it('直通解析：白名单、URL 前缀校验、id 去前缀、关键词过滤', async () => {
    const { ctx } = makeCtx([route])
    const results = await plugin.search('爱看电影', ctx)
    expectValidPluginResults(plugin, results)
    expect(results.map((r) => r.unique_id)).toEqual(['ikantv-555', 'ikantv-m2'])
    const r = results[0]!
    expect(r.message_id).toBe('m1')
    expect(r.datetime).toBe('2025-04-01T10:00:00Z')
    expect(r.tags).toEqual(['电影'])
    expect(r.images).toEqual(['https://img.example.com/a.jpg'])
    expect(r.links.map((l) => l.type)).toEqual(['quark', 'quark', 'ed2k'])
    expect(r.links[0]!.work_title).toBe('爱看电影')
    expect(results[1]!.links[0]).toMatchObject({ type: 'baidu', password: 'x9' })
  })

  it('请求形态：kw/limit/title_en，Referer', async () => {
    const { ctx, mock } = makeCtx([route], { ext: { title_en: 'The Movie' } })
    await plugin.search('爱看', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.url).toBe(
      `https://api.naspt.vip/api/open/pansou/search?kw=${encodeURIComponent('爱看')}&limit=50&title_en=The%20Movie`,
    )
    expect(mock.calls[0]!.headers.referer).toBe('https://api.naspt.vip/')
  })

  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: 'naspt', respond: { code: 0, data: [] } }])
    expect(await plugin.search('x', ctx)).toEqual([])
  })

  it('code!==0 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'naspt', respond: { code: 1, message: 'bad' } }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('bad')
  })

  it('HTTP 500 抛错且最多 3 次子请求', async () => {
    const { ctx, mock } = makeCtx([{ match: 'naspt', respond: 'err', status: 500 }])
    await expect(plugin.search('x', ctx)).rejects.toThrow()
    expect(mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'naspt', respond: 'nope' }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('JSON')
  })
})
