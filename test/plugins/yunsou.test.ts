// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取；真实站点是否匹配未验证。
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/yunsou'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx, type MockRoute } from '../helpers/mockFetch'

function routes(): MockRoute[] {
  return [
    { match: /\/s\/[^/-]*\.html$/, respond: fixture('yunsou/page1.html') },
    { match: '-2.html', respond: fixture('yunsou/page2.html') },
    { match: '-3.html', respond: fixture('yunsou/page3.html') },
    { match: '-4.html', respond: fixture('yunsou/page4.html') },
    { match: '-5.html', respond: fixture('yunsou/page4.html') },
  ]
}

describe('yunsou', () => {
  it('第 1 页 + 按 :total 翻页（默认上限 3 页），顺序与解析字段', async () => {
    const { ctx, mock } = makeCtx(routes())
    const res = await plugin.search('仙逆', ctx)
    expectValidPluginResults(plugin, res)
    // total=45 -> 5 页，被 maxPagesYunsou=3 截断；“无关”被关键词过滤
    expect(mock.calls).toHaveLength(3)
    expect(res.map((r) => r.title)).toEqual(['仙逆 1', '仙逆 2 & 特辑', '仙逆 3', '仙逆 4'])

    expect(res[0]).toMatchObject({ unique_id: 'yunsou-https%3A%2F%2Fpan.quark.cn%2Fs%2Fp1a', content: '来源A', datetime: '2026-09-01T00:00:00Z' })
    expect(res[0]!.links[0]).toMatchObject({ type: 'quark', url: 'https://pan.quark.cn/s/p1a', password: '' })
    // @click.stop 绑定 + URL 中的 pwd
    expect(res[1]!.links[0]).toMatchObject({ type: 'baidu', password: 'ab12' })
    // 显式口令优先
    expect(res[2]!.links[0]).toMatchObject({ type: 'xunlei', password: 'x9' })
    // 未知域名 -> others；日期非法回落到当前时间
    expect(res[3]!.links[0]).toMatchObject({ type: 'others' })
    expect(Math.abs(Date.parse(res[3]!.datetime) - Date.now())).toBeLessThan(60_000)
  })

  it('请求形态：分页路径 /s/<kw>-N.html，Referer', async () => {
    const { ctx, mock } = makeCtx(routes())
    await plugin.search(' 仙逆 ', ctx)
    expect(mock.calls.map((c) => c.url).sort()).toEqual([
      'https://wpys.cc/s/%E4%BB%99%E9%80%86-2.html',
      'https://wpys.cc/s/%E4%BB%99%E9%80%86-3.html',
      'https://wpys.cc/s/%E4%BB%99%E9%80%86.html',
    ])
    for (const c of mock.calls) {
      expect(c.method).toBe('GET')
      expect(c.headers['referer']).toBe('https://wpys.cc/')
    }
  })

  it('页数上限取 config.maxPagesYunsou', async () => {
    const one = makeCtx(routes(), { config: { maxPagesYunsou: 1 } })
    await plugin.search('仙逆', one.ctx)
    expect(one.mock.calls).toHaveLength(1)
    const five = makeCtx(routes(), { config: { maxPagesYunsou: 10 } })
    const res = await plugin.search('仙逆', five.ctx)
    expect(five.mock.calls).toHaveLength(5) // 总页数 5 < 10
    expect(res).toHaveLength(6) // 第 5 页复用 page4 夹具，不去重（与 Go 一致）
  })

  it('某页失败被跳过，第 1 页失败则抛错', async () => {
    const r = routes()
    r[1] = { match: '-2.html', respond: 'err', status: 404 }
    const { ctx } = makeCtx(r)
    const res = await plugin.search('仙逆', ctx)
    expect(res.map((x) => x.title)).toEqual(['仙逆 1', '仙逆 2 & 特辑', '仙逆 4'])

    const bad = makeCtx([{ match: 'wpys.cc', respond: 'err', status: 500 }])
    await expect(plugin.search('仙逆', bad.ctx)).rejects.toThrow(/HTTP 500/)
  })

  it('子请求总数不超过 2N（全部 500 的最坏情况单页 2 次）', async () => {
    const bad = makeCtx([{ match: 'wpys.cc', respond: 'err', status: 500 }])
    await expect(plugin.search('仙逆', bad.ctx)).rejects.toThrow()
    expect(bad.budget.usedCount).toBeLessThanOrEqual(2)
    const ok = makeCtx(routes(), { config: { maxPagesYunsou: 5 } })
    await plugin.search('仙逆', ok.ctx)
    expect(ok.budget.usedCount).toBeLessThanOrEqual(10)
  })

  it('无结果与空关键词', async () => {
    const { ctx } = makeCtx([{ match: 'wpys.cc', respond: '<html><body><div class="list"></div></body></html>' }])
    expect(await plugin.search('仙逆', ctx)).toEqual([])
    const e = makeCtx([])
    expect(await plugin.search('  ', e.ctx)).toEqual([])
    expect(e.mock.calls).toHaveLength(0)
  })
})
