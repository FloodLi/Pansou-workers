// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/wanou'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'woog.nxog.eu.org/api.php/provide/vod', respond: () => fixture('wanou/search.json') }

describe('wanou', () => {
  it('元数据', () => {
    expect(plugin.name).toBe('wanou')
  })

  it('请求形态', async () => {
    const { ctx, mock } = makeCtx([route])
    await plugin.search('测试 影片', ctx)
    expect(mock.calls).toHaveLength(1)
    const c = mock.calls[0]!
    expect(c.method).toBe('GET')
    expect(c.url).toBe('https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd=' + encodeURIComponent('测试 影片'))
    expect(c.headers.referer).toBe('https://woog.nxog.eu.org/')
  })

  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: 'woog', respond: { code: 1, msg: 'ok', list: [] } }])
    expect(await plugin.search('x', ctx)).toEqual([])
  })

  it('code!==1 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'woog', respond: { code: 0, msg: '失败' } }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('失败')
  })

  it('HTTP 500 抛错且最多 2 次子请求', async () => {
    const { ctx, mock } = makeCtx([{ match: 'woog', respond: 'err', status: 500 }])
    await expect(plugin.search('x', ctx)).rejects.toThrow()
    expect(mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'woog', respond: 'not json' }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('JSON')
  })

  it('解析字段、链接类型与提取码，丢弃无效项', async () => {
    const { ctx } = makeCtx([route])
    const results = await plugin.search('测试', ctx)
    expectValidPluginResults(plugin, results)
    expect(results.map((r) => r.unique_id)).toEqual(['wanou-101', 'wanou-102'])
    const r = results[0]!
    expect(r.title).toBe('测试影片')
    expect(r.content).toBe('主演: 甲,乙 | 导演: 丙 | 地区: 大陆 | 年份: 2024 | 状态: HD')
    expect(r.tags).toEqual(['2024', '大陆'])
    expect(r.images).toEqual(['https://img.example.com/1.jpg'])
    expect(r.links.map((l) => [l.type, l.url, l.password])).toEqual([
      ['quark', 'https://pan.quark.cn/s/abc123', ''],
      ['baidu', 'https://pan.baidu.com/s/1xyz?pwd=ab12', 'ab12'],
      ['quark', 'https://pan.quark.cn/s/zzz999', ''],
    ])
    expect(results[1]!.links[0]!.type).toBe('magnet')
  })
})
