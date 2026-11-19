// fixture（test/fixtures/xiaokupan/response.json）为合成数据，依据 Go 解析逻辑构造，非真实抓取。
// 它让 merged_by_type、magnet 数组与一个 note 都通过引用节点（t=4）解析，覆盖引用路径。
// "重新发现函数 ID" 路径用合成首页/入口脚本模拟：默认 ID 返回 500 -> 抓首页 -> 抓 index-*.js -> 用新 ID 重试。
import { beforeEach, describe, expect, it } from 'vitest'
import plugin, { cleanText, resetServerFunctionId } from '../../src/plugins/xiaokupan'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const DEFAULT_ID = 'ffb7ba806a267ced7478dc27716e79ea729a98a801af2ac9c3647bdaca91af78'
const NEW_ID = 'a'.repeat(63) + 'b'
const OLD_HASH = 'c'.repeat(64)
const body = () => fixture('xiaokupan/response.json')

beforeEach(() => resetServerFunctionId())

describe('xiaokupan', () => {
  it('解析 Seroval 树（含引用节点），过滤重复/非法/空 note/不匹配关键词', async () => {
    const { ctx, mock } = makeCtx([{ match: `/_serverFn/${DEFAULT_ID}`, respond: body() }])
    const results = await plugin.search('测试', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(results.map((r) => r.title)).toEqual(['测试资源', '测试磁力'])
    const [a, m] = results
    expect(a!.links[0]).toMatchObject({ type: 'baidu', url: 'https://pan.baidu.com/s/1abc', password: 'x1y2', work_title: '测试资源' })
    expect(a!.datetime).toBe('2025-01-02T03:04:05Z')
    expect(a!.tags).toEqual(['baidu', '某来源'])
    expect(a!.images).toEqual(['https://img.example/1.png'])
    expect(a!.unique_id).toMatch(/^xiaokupan-[0-9a-f]{64}$/)
    expect(a!.message_id).toBe(a!.unique_id)
    expect(m!.links[0]).toMatchObject({ type: 'magnet', url: 'magnet:?xt=urn:btih:abc' })
    expectValidPluginResults(plugin, results)
  })

  it('请求形态：GET _serverFn + payload + 头', async () => {
    const { ctx, mock } = makeCtx([{ match: '/_serverFn/', respond: body() }])
    await plugin.search('测试 资源', ctx)
    const call = mock.calls[0]!
    expect(call.method).toBe('GET')
    const u = new URL(call.url)
    expect(u.pathname).toBe(`/_serverFn/${DEFAULT_ID}`)
    const payload = JSON.parse(u.searchParams.get('payload')!)
    expect(payload).toEqual({
      f: 63,
      m: [],
      t: { i: 0, o: 0, t: 10, p: { k: ['data'], v: [{ i: 1, o: 0, t: 10, p: { k: ['query'], v: [{ t: 1, s: '测试 资源' }] } }] } },
    })
    expect(call.headers['x-tsr-serverfn']).toBe('true')
    expect(call.headers['origin']).toBe('https://xiaokupan.com')
    expect(call.headers['referer']).toBe('https://xiaokupan.com/s/%E6%B5%8B%E8%AF%95%20%E8%B5%84%E6%BA%90')
  })

  it('函数 ID 失效：重新发现并重试一次，共 4 个子请求，且 ID 被模块级缓存', async () => {
    const asset = `x"${OLD_HASH}";y"${NEW_ID}";path:"/s/$query";z"${'d'.repeat(64)}"`
    const routes = [
      { match: `/_serverFn/${DEFAULT_ID}`, respond: 'err', status: 500 },
      { match: `/_serverFn/${NEW_ID}`, respond: body() },
      { match: (c: { url: string }) => c.url === 'https://xiaokupan.com/', respond: '<script src="/assets/index-AbC_1-x.js"></script>' },
      { match: '/assets/index-AbC_1-x.js', respond: asset },
    ]
    const { ctx, mock } = makeCtx(routes)
    const results = await plugin.search('测试', ctx)
    expect(results).toHaveLength(2)
    expect(mock.calls.map((c) => new URL(c.url).pathname)).toEqual([
      `/_serverFn/${DEFAULT_ID}`,
      '/',
      '/assets/index-AbC_1-x.js',
      `/_serverFn/${NEW_ID}`,
    ])
    expect(mock.calls.length).toBeLessThanOrEqual(4)
    // 同一 isolate 内第二次搜索直接用新 ID
    const second = makeCtx(routes)
    await plugin.search('测试', second.ctx)
    expect(second.mock.calls).toHaveLength(1)
    expect(new URL(second.mock.calls[0]!.url).pathname).toBe(`/_serverFn/${NEW_ID}`)
  })

  it('刷新失败时抛出带两段原因的错误；重试后仍失败也抛错', async () => {
    const down = makeCtx([
      { match: '/_serverFn/', respond: 'err', status: 500 },
      { match: (c) => c.url === 'https://xiaokupan.com/', respond: '<html>no script</html>' },
    ])
    await expect(plugin.search('测试', down.ctx)).rejects.toThrow(/刷新接口标识失败: 首页未找到入口脚本/)
    expect(down.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('响应缺少 merged_by_type 或非法 JSON 时抛错', async () => {
    const bad = makeCtx([
      { match: '/_serverFn/', respond: 'not json' },
      { match: (c) => c.url === 'https://xiaokupan.com/', respond: '<html></html>' },
    ])
    await expect(plugin.search('测试', bad.ctx)).rejects.toThrow()
  })

  it('空结果与空关键词', async () => {
    const empty = JSON.stringify({
      t: 10,
      p: { k: ['result'], v: [{ t: 10, p: { k: ['searchResults'], v: [{ t: 10, p: { k: ['merged_by_type'], v: [{ t: 10, p: { k: [], v: [] } }] } }] } }] },
    })
    const { ctx } = makeCtx([{ match: '/_serverFn/', respond: empty }])
    expect(await plugin.search('测试', ctx)).toEqual([])
    const none = makeCtx([])
    expect(await plugin.search('  ', none.ctx)).toEqual([])
    expect(none.mock.calls).toHaveLength(0)
  })

  it('cleanText 去除投稿链接后缀', () => {
    expect(cleanText('  a   b 投稿链接：')).toBe('a b')
    expect(cleanText('x链接:')).toBe('x')
  })
})
