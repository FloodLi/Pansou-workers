// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/melost'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'melost.cn/v1/search/disk', method: 'POST', respond: () => fixture('melost/page.json') }

describe('melost', () => {
  it('3 页并发、去重、解析字段', async () => {
    const { ctx, mock } = makeCtx([route])
    const results = await plugin.search('影盘', ctx)
    expect(mock.calls).toHaveLength(3)
    expectValidPluginResults(plugin, results)
    // 3 页返回相同数据 -> 按 disk_id 去重；d4 无链接、d5 被关键词过滤
    expect(results.map((r) => r.unique_id)).toEqual(['melost-d1', 'melost-d2', 'melost-d3'])
    const r = results[0]!
    expect(r.title).toBe('影盘资源&一')
    expect(r.content).toBe('文件1\n文件2\n分享用户: alice\n标签: 电影、高清')
    expect(r.tags).toEqual(['电影', '高清'])
    expect(r.datetime).toBe('2025-05-01T12:00:00Z')
    expect(r.links[0]).toMatchObject({ type: 'quark', password: 'pw12' })
    expect(results[1]!.links[0]!.type).toBe('baidu')
    expect(results[2]!.links[0]!.type).toBe('lanzou')
  })

  it('请求形态：POST JSON 体与头', async () => {
    const { ctx, mock } = makeCtx([route])
    await plugin.search('影盘', ctx)
    const pages = mock.calls.map((c) => JSON.parse(c.body).page).sort()
    expect(pages).toEqual([1, 2, 3])
    const c = mock.calls[0]!
    expect(c.url).toBe('https://www.melost.cn/v1/search/disk')
    expect(c.headers.origin).toBe('https://www.melost.cn')
    expect(c.headers.referer).toBe('https://www.melost.cn/search')
    const body = JSON.parse(c.body)
    expect(body).toMatchObject({ q: '影盘', size: 30, search_ticket: '', exact: false })
    expect(body.adv_params).toEqual({ wechat_pwd: '', search_code: '', platform: 'pc', fp_data: '', automated: '0' })
  })

  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: 'melost', respond: { code: 200, data: { list: [] } } }])
    expect(await plugin.search('x', ctx)).toEqual([])
  })

  it('全部页面失败时抛错，部分失败时保留成功页', async () => {
    const bad = makeCtx([{ match: 'melost', respond: 'err', status: 500 }])
    await expect(plugin.search('x', bad.ctx)).rejects.toThrow()
    expect(bad.mock.calls).toHaveLength(3)

    let n = 0
    const part = makeCtx([
      { match: 'melost', respond: () => (n++ === 0 ? fixture('melost/page.json') : { code: 500, msg: 'x' }) },
    ])
    const results = await plugin.search('影盘', part.ctx)
    expect(results).toHaveLength(3)
  })

  it('api code!==200 抛错；非法 JSON 抛错', async () => {
    const a = makeCtx([{ match: 'melost', respond: { code: 403, msg: 'forbidden' } }])
    await expect(plugin.search('x', a.ctx)).rejects.toThrow('forbidden')
    const b = makeCtx([{ match: 'melost', respond: 'nope' }])
    await expect(plugin.search('x', b.ctx)).rejects.toThrow('JSON')
  })
})
