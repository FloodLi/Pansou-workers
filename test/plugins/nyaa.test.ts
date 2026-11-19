// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取，真实站点是否匹配未验证
import { describe, expect, it } from 'vitest'
import nyaa from '../../src/plugins/nyaa'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

describe('nyaa', () => {
  it('解析表格行（magnet、时间、统计、标签）', async () => {
    const { ctx, mock } = makeCtx([{ match: 'nyaa.si', respond: fixture('nyaa/search.html') }])
    const res = await nyaa.search('frieren', ctx)
    expect(res).toHaveLength(1) // 第二行不含关键词，第三行无 magnet
    const r = res[0]!
    expect(r.unique_id).toBe('nyaa-1001')
    expect(r.title).toBe('[Group] Frieren - 01 [1080p]')
    expect(r.datetime).toBe('2023-11-14T22:13:20Z')
    expect(r.links[0]).toMatchObject({ type: 'magnet', password: '' })
    expect(r.links[0]!.url).toContain('magnet:?xt=urn:btih:aaaabbbb')
    expect(r.content).toBe('分类: Anime - English-translated | 大小: 1.4 GiB | 做种: 120 | 下载: 5 | 完成: 900')
    expect(r.tags).toEqual(['Anime - English-translated', '做种:120', '下载:5', '完成:900'])
    expectValidPluginResults(nyaa, res)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.url).toBe('https://nyaa.si/?f=0&c=0_0&q=frieren')
  })
  it('ext.title_en 覆盖搜索词（同时用于过滤）', async () => {
    const { ctx, mock } = makeCtx([{ match: 'nyaa.si', respond: fixture('nyaa/search.html') }], { ext: { title_en: 'Other Show' } })
    const res = await nyaa.search('别的名字', ctx)
    expect(mock.calls[0]!.url).toContain('q=Other+Show')
    expect(res.map((r) => r.unique_id)).toEqual(['nyaa-1002'])
  })
  it('无表格返回空', async () => {
    const { ctx } = makeCtx([{ match: 'nyaa.si', respond: '<html><body>No results</body></html>' }])
    expect(await nyaa.search('x', ctx)).toEqual([])
  })
  it('HTTP 500 抛错，子请求不超过 3', async () => {
    const { ctx, mock } = makeCtx([{ match: 'nyaa.si', respond: 'e', status: 500 }])
    await expect(nyaa.search('x', ctx)).rejects.toThrow(/500/)
    expect(mock.calls.length).toBeLessThanOrEqual(3)
  })
})
