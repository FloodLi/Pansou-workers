// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/meitizy'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const route = { match: 'apis.451024.xyz/api/media/search', respond: () => fixture('meitizy/search.json') }

describe('meitizy', () => {
  it('解析字段、类型回退、提取码、时间，过滤无效链接与不相关项', async () => {
    const { ctx } = makeCtx([route])
    const results = await plugin.search('美体教程', ctx)
    expectValidPluginResults(plugin, results)
    expect(results.map((r) => r.unique_id)).toEqual(['meitizy-1', 'meitizy-2', 'meitizy-3'])
    expect(results[0]!.links[0]).toMatchObject({ type: 'quark', password: 'ab12' })
    expect(results[0]!.datetime).toBe('2025-11-25T22:59:53Z')
    expect(results[0]!.tags).toEqual(['教程'])
    expect(results[1]!.links[0]!.type).toBe('aliyun')
    expect(results[1]!.datetime).toBe('2025-10-01T12:00:00Z') // created_at 为空，回退 updated_at（无时区按 UTC）
    expect(results[2]!.links[0]).toMatchObject({ type: 'baidu', password: 'zz99' }) // link_type 未知 -> 按 URL 识别
  })

  it('请求形态：POST JSON、Origin/Referer', async () => {
    const { ctx, mock } = makeCtx([route])
    await plugin.search('美体', ctx)
    expect(mock.calls).toHaveLength(1)
    const c = mock.calls[0]!
    expect(c.method).toBe('POST')
    expect(c.url).toBe('https://apis.451024.xyz/api/media/search')
    expect(JSON.parse(c.body)).toEqual({ title: '美体', page: 1, size: 10 })
    expect(c.headers['content-type']).toBe('application/json')
    expect(c.headers.origin).toBe('https://video.451024.xyz')
    expect(c.headers.referer).toBe('https://video.451024.xyz/')
  })

  it('空结果', async () => {
    const { ctx } = makeCtx([{ match: 'apis.451024', respond: { data: [], total: 0 } }])
    expect(await plugin.search('x', ctx)).toEqual([])
  })

  it('HTTP 500 抛错且最多 3 次子请求', async () => {
    const { ctx, mock } = makeCtx([{ match: 'apis.451024', respond: 'err', status: 500 }])
    await expect(plugin.search('x', ctx)).rejects.toThrow()
    expect(mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: 'apis.451024', respond: 'nope' }])
    await expect(plugin.search('x', ctx)).rejects.toThrow('JSON')
  })
})
