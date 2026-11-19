// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取，真实站点是否匹配未验证
import { describe, expect, it } from 'vitest'
import cldi from '../../src/plugins/cldi'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const HASH = '0123456789abcdef0123456789abcdef01234567'

describe('cldi', () => {
  it('按 maxPagesCldi 请求多页，磁力由 hash 拼出', async () => {
    const { ctx, mock } = makeCtx([{ match: '/search-', respond: fixture('cldi/search.html') }], { config: { maxPagesCldi: 3 } })
    const res = await cldi.search('流浪地球', ctx)
    expect(mock.calls).toHaveLength(3)
    expect(mock.calls.map((c) => c.url).sort()).toEqual([1, 2, 3].map((p) => `https://cm7jll1f.1122137.xyz/search-%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83-0-2-${p}.html`))
    expect(res).toHaveLength(3) // 每页同一条（Go 不跨页去重）
    const r = res[0]!
    expect(r.unique_id).toBe(`cldi-${HASH}`)
    expect(r.title).toBe('流浪地球2 4K')
    expect(r.datetime).toBe('2023-01-22T00:00:00Z')
    expect(r.links[0]).toMatchObject({ type: 'magnet', url: `magnet:?xt=urn:btih:${HASH}`, work_title: '流浪地球2 4K' })
    expectValidPluginResults(cldi, res)
  })
  it('maxPagesCldi=1 只请求一页', async () => {
    const { ctx, mock } = makeCtx([{ match: '/search-', respond: fixture('cldi/search.html') }], { config: { maxPagesCldi: 1 } })
    await cldi.search('流浪地球', ctx)
    expect(mock.calls).toHaveLength(1)
  })
  it('旧版 .ssbox 页面', async () => {
    const { ctx } = makeCtx([{ match: '/search-', respond: fixture('cldi/legacy.html') }], { config: { maxPagesCldi: 1 } })
    const res = await cldi.search('流浪地球', ctx)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ title: '流浪地球 旧版', content: 'file.mkv (2GB)', tags: ['影视'], datetime: '2022-05-06T00:00:00Z' })
    expect(res[0]!.unique_id).toMatch(/^cldi-[0-9a-f]{8}$/)
    expectValidPluginResults(cldi, res)
  })
  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: '/search-', respond: '<html></html>' }], { config: { maxPagesCldi: 2 } })
    expect(await cldi.search('x', ctx)).toEqual([])
  })
  it('首页 500 抛错；后续页失败被忽略', async () => {
    const bad = makeCtx([{ match: '/search-', respond: 'e', status: 500 }], { config: { maxPagesCldi: 3 } })
    await expect(cldi.search('x', bad.ctx)).rejects.toThrow(/500/)
    expect(bad.mock.calls.length).toBeLessThanOrEqual(15)
    const half = makeCtx(
      [
        { match: '-0-2-1.html', respond: fixture('cldi/search.html') },
        { match: '-0-2-', respond: 'e', status: 500 },
      ],
      { config: { maxPagesCldi: 3 } },
    )
    expect(await cldi.search('流浪地球', half.ctx)).toHaveLength(1)
    expect(half.mock.calls.length).toBeLessThanOrEqual(15)
  })
})
