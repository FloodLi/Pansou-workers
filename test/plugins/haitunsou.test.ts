// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取；真实站点是否匹配未验证。
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/haitunsou'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const URL_PART = 'haitunsou.com/s/'

describe('haitunsou', () => {
  it('解析内嵌 JSON：转义、标题拆分、类型校验、去重、关键词过滤', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: fixture('haitunsou/search.html') }])
    const res = await plugin.search('仙逆', ctx)
    expectValidPluginResults(plugin, res)
    expect(res.map((r) => r.unique_id)).toEqual([
      'haitunsou-5581',
      expect.stringMatching(/^haitunsou-[0-9a-f]{16}$/), // id=0 时用 URL 哈希
    ])
    const a = res[0]!
    expect(a.title).toBe("仙逆特'别篇")
    expect(a.content).toBe('仙逆特别篇')
    expect(a.datetime).toBe('2026-09-01T00:00:00Z')
    expect(a.tags).toEqual(['quark'])
    expect(a.links).toHaveLength(1)
    expect(a.links[0]).toMatchObject({ type: 'quark', url: 'https://pan.quark.cn/s/abc', password: '', work_title: "仙逆特'别篇" })
    const b = res[1]!
    expect(b.links[0]).toMatchObject({ type: 'baidu', password: '6666' })
    expect(b.content).toBe('仙逆 百度') // name 为空时回落到原标题
  })

  it('请求形态：GET /s/<关键词>.html，仅 1 次子请求', async () => {
    const { ctx, mock, budget } = makeCtx([{ match: URL_PART, respond: fixture('haitunsou/search.html') }])
    await plugin.search(' 仙 逆 ', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://www.haitunsou.com/s/%E4%BB%99%20%E9%80%86.html')
    expect(mock.calls[0]!.headers['referer']).toBe('https://www.haitunsou.com/')
    expect(budget.usedCount).toBeLessThanOrEqual(1)
  })

  it('空关键词不发请求', async () => {
    const { ctx, mock } = makeCtx([])
    expect(await plugin.search('   ', ctx)).toEqual([])
    expect(mock.calls).toHaveLength(0)
  })

  it('无匹配结果返回空数组', async () => {
    const html = "<script>const list = JSON.parse('[]');</script>"
    const { ctx } = makeCtx([{ match: URL_PART, respond: html }])
    expect(await plugin.search('仙逆', ctx)).toEqual([])
  })

  it('HTTP 500 抛错且不重试', async () => {
    const { ctx, mock } = makeCtx([{ match: URL_PART, respond: 'err', status: 500 }])
    await expect(plugin.search('仙逆', ctx)).rejects.toThrow(/HTTP 500/)
    expect(mock.calls).toHaveLength(1)
  })

  it('缺少内嵌数据或 JSON 非法时抛错', async () => {
    const a = makeCtx([{ match: URL_PART, respond: '<html></html>' }])
    await expect(plugin.search('仙逆', a.ctx)).rejects.toThrow(/未找到页面内嵌结果/)
    const b = makeCtx([{ match: URL_PART, respond: "const list = JSON.parse('{oops');" }])
    await expect(plugin.search('仙逆', b.ctx)).rejects.toThrow(/JSON/)
  })
})
