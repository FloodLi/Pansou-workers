// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取；真实站点是否匹配未验证。
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/zlxapp'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const URL_PART = 'zlxapp.top/s/'

describe('zlxapp', () => {
  it('解析 listItemsData：多链接、已删除/状态过滤、标签、去重、关键词过滤', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: fixture('zlxapp/search.html') }])
    const res = await plugin.search('仙逆', ctx)
    expectValidPluginResults(plugin, res)
    expect(res.map((r) => r.unique_id)).toEqual(['zlxapp-11', 'zlxapp-12'])

    const a = res[0]!
    expect(a.title).toBe('仙逆 4K')
    expect(a.content).toBe('最新 [更新] ] 到 100 集')
    expect(a.datetime).toBe('2026-08-30T00:00:00Z')
    expect(a.tags).toEqual(['国漫', '4K', '动漫'])
    expect(a.links.map((l) => [l.type, l.url, l.password, l.work_title])).toEqual([
      ['quark', 'https://pan.quark.cn/s/aaa', '', '仙逆 夸克'],
      ['baidu', 'https://pan.baidu.com/s/bbb?pwd=abcd', 'abcd', '仙逆百度'],
      ['guangya', 'https://www.guangyapan.com/s/ggg', '1234', '仙逆 4K'],
    ])
    const b = res[1]!
    expect(b.links[0]).toMatchObject({ type: 'uc', password: '9999' })
    expect(b.content).toBe('仙逆 无links')
    expect(b.tags).toEqual(['国漫'])
  })

  it('请求形态与响应上限', async () => {
    const { ctx, mock } = makeCtx([{ match: URL_PART, respond: fixture('zlxapp/search.html') }])
    await plugin.search('仙逆', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://www.zlxapp.top/s/%E4%BB%99%E9%80%86.html')
    expect(mock.calls[0]!.headers['referer']).toBe('https://www.zlxapp.top/')
  })

  it('超过 2MB 抛错', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: 'x'.repeat((2 << 20) + 10) }])
    await expect(plugin.search('仙逆', ctx)).rejects.toThrow(/上限/)
  })

  it('空数组返回 []；空关键词不请求', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: 'const listItemsData = [];' }])
    expect(await plugin.search('仙逆', ctx)).toEqual([])
    const e = makeCtx([])
    expect(await plugin.search(' ', e.ctx)).toEqual([])
    expect(e.mock.calls).toHaveLength(0)
  })

  it('HTTP 500 重试至多 3 次后抛错', async () => {
    const { ctx, mock, budget } = makeCtx([{ match: URL_PART, respond: 'err', status: 500 }])
    await expect(plugin.search('仙逆', ctx)).rejects.toThrow(/HTTP 500/)
    expect(mock.calls).toHaveLength(3)
    expect(budget.usedCount).toBeLessThanOrEqual(3)
  })

  it('缺少 marker / JSON 非法 抛错', async () => {
    const a = makeCtx([{ match: URL_PART, respond: '<html></html>' }])
    await expect(plugin.search('仙逆', a.ctx)).rejects.toThrow(/listItemsData/)
    const b = makeCtx([{ match: URL_PART, respond: 'const listItemsData = [{bad}];' }])
    await expect(plugin.search('仙逆', b.ctx)).rejects.toThrow(/JSON/)
  })
})
