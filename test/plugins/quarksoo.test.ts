// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取；真实站点是否匹配未验证。
import { describe, expect, it } from 'vitest'
import plugin from '../../src/plugins/quarksoo'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const URL_PART = 'quarksoo.cc/search.php'

describe('quarksoo', () => {
  it('解析表格：只取夸克链接、关键词过滤、去重、按标题排序', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: fixture('quarksoo/search.html') }])
    const res = await plugin.search('仙逆', ctx)
    expectValidPluginResults(plugin, res)
    expect(res.map((r) => r.title)).toEqual(['仙逆 & 第一季', '仙逆 笔误域名', '仙逆 第一季', '仙逆 第二季'])
    expect(res.map((r) => r.links[0]!.url)).toEqual([
      'https://pan.quark.cn/s/a111',
      'https://pan.qoark.cn/s/d555',
      'https://pan.quark.cn/s/c444', // 第二格没有 a 时回落到整行第一个 a
      'https://pan.quark.cn/s/b222',
    ])
    for (const r of res) {
      expect(r.links[0]).toMatchObject({ type: 'quark', password: '' })
      expect(r.unique_id).toMatch(/^quarksoo-[0-9a-f]{16}$/)
    }
  })

  it('UniqueID 稳定', async () => {
    const run = async () => {
      const { ctx } = makeCtx([{ match: URL_PART, respond: fixture('quarksoo/search.html') }])
      return (await plugin.search('仙逆', ctx)).map((r) => r.unique_id)
    }
    expect(await run()).toEqual(await run())
  })

  it('请求形态：GET ?q=，带 Referer', async () => {
    const { ctx, mock } = makeCtx([{ match: URL_PART, respond: fixture('quarksoo/search.html') }])
    await plugin.search('仙逆 第一', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://quarksoo.cc/search.php?q=%E4%BB%99%E9%80%86+%E7%AC%AC%E4%B8%80')
    expect(mock.calls[0]!.headers['referer']).toBe('https://quarksoo.cc/')
  })

  it('无结果返回空数组', async () => {
    const { ctx } = makeCtx([{ match: URL_PART, respond: '<html><body><table></table></body></html>' }])
    expect(await plugin.search('仙逆', ctx)).toEqual([])
  })

  it('HTTP 500 重试至多 3 次后抛错；404 不重试', async () => {
    const a = makeCtx([{ match: URL_PART, respond: 'err', status: 500 }])
    await expect(plugin.search('仙逆', a.ctx)).rejects.toThrow(/HTTP 500/)
    expect(a.mock.calls).toHaveLength(3)
    const b = makeCtx([{ match: URL_PART, respond: 'nf', status: 404 }])
    await expect(plugin.search('仙逆', b.ctx)).rejects.toThrow(/404/)
    expect(b.mock.calls).toHaveLength(1)
  })
})
