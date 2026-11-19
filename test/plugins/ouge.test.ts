// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/ouge'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'woog.nxog.eu.org/api.php/provide/vod', respond: () => fixture('ouge/search.json') }

describe('ouge', () => {
  it('元数据', () => {
    expect(plugin.name).toBe('ouge')
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

  it('解析字段与链接类型（优先接口标识），丢弃无效项', async () => {
    const { ctx } = makeCtx([route])
    const results = await plugin.search('欧歌', ctx)
    expectValidPluginResults(plugin, results)
    expect(results.map((r) => r.unique_id)).toEqual(['ouge-201'])
    expect(results[0]!.links.map((l) => [l.type, l.password])).toEqual([
      ['pikpak', ''],
      ['baidu', ''], // BD 标识优先于 URL 域名
      ['xunlei', 'ab12'],
    ])
    expect(results[0]!.tags).toEqual(['2023', '美国'])
  })
})
