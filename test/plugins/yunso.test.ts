// fixture（test/fixtures/yunso/page.html）为合成数据，依据 Go 解析逻辑构造，非真实抓取。
// 含：新版直链、旧版 base64+XOR（URL 含中文，验证 UTF-8 字节语义）、纯 base64、同 URL 去重、
// 无法解密、无锚点卡片。
import { describe, expect, it } from 'vitest'
import plugin, { decryptUrl, parseItems } from '../../src/plugins/yunso'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const page = () => fixture('yunso/page.html')
const ok = (data: string) => ({ code: 0, msg: '', data })
const pageOf = (url: string) => Number(new URL(url).searchParams.get('page'))

describe('yunso', () => {
  it('解析卡片：直链/旧版 XOR/纯 base64、去重、丢弃无法解密项', async () => {
    const { ctx, mock } = makeCtx([
      {
        match: '/api/Core/search2',
        method: 'POST',
        respond: (c) => ok(pageOf(c.url) === 1 ? page() : ''),
      },
    ])
    const results = await plugin.search('测试', ctx)
    expect(mock.calls).toHaveLength(3)
    expect(results.map((r) => r.unique_id)).toEqual(['yunso-sid1', 'yunso-sid2', 'yunso-sid3'])
    const [q, b, x] = results
    expect(q!.title).toBe('测试&资源 合集')
    expect(q!.links[0]).toMatchObject({ type: 'quark', url: 'https://pan.quark.cn/s/aaa1', password: 'k3k3' })
    expect(q!.content).toBe('测试 资源 预览\n12个文件 & 3.5GB\n网盘: 夸克网盘')
    expect(q!.tags).toEqual(['夸克网盘', '高清', '热门'])
    expect(q!.datetime).toBe('2025-03-01T10:20:30Z')
    expect(b!.links[0]).toMatchObject({ type: 'baidu', url: 'https://pan.baidu.com/s/1中文abc?pwd=ab12', password: 'ab12' })
    expect(x!.links[0]).toMatchObject({ type: 'xunlei', url: 'https://pan.xunlei.com/s/VOabc?pwd=zz99', password: 'zz99' })
    expectValidPluginResults(plugin, results)
  })

  it('请求形态：三页并发 POST，参数与头', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/Core/search2', respond: ok('') }])
    await plugin.search('a b', ctx).catch(() => undefined)
    expect(mock.calls).toHaveLength(3)
    const c = mock.calls.find((x) => pageOf(x.url) === 2)!
    expect(c.method).toBe('POST')
    expect(c.url).toBe(
      'https://www.yunso.net/api/Core/search2?limit=20&mode=90002&page=2&requestID=&scope_content=0&screen_filetype=&stype=&uk=&wd=a+b',
    )
    expect(c.body).toBe('')
    expect(c.headers['x-requested-with']).toBe('XMLHttpRequest')
    expect(c.headers['origin']).toBe('https://www.yunso.net')
    expect(c.headers['referer']).toBe('https://www.yunso.net/index/user/s?wd=a+b')
    expect(mock.calls.map((x) => pageOf(x.url)).sort()).toEqual([1, 2, 3])
  })

  it('空结果返回 []', async () => {
    const { ctx } = makeCtx([{ match: '/api/Core/search2', respond: ok('') }])
    expect(await plugin.search('测试', ctx)).toEqual([])
  })

  it('单页失败不影响其它页；全部失败则抛错；不重试', async () => {
    const partial = makeCtx([
      {
        match: '/api/Core/search2',
        respond: (c) => (pageOf(c.url) === 1 ? ok(page()) : new Response('x', { status: 500 })),
      },
    ])
    expect(await plugin.search('测试', partial.ctx)).toHaveLength(3)
    expect(partial.mock.calls).toHaveLength(3)

    const allBad = makeCtx([{ match: '/api/Core/search2', respond: 'oops', status: 500 }])
    await expect(plugin.search('测试', allBad.ctx)).rejects.toThrow(/HTTP 500/)
    expect(allBad.mock.calls).toHaveLength(3)

    const badJson = makeCtx([{ match: '/api/Core/search2', respond: 'not json' }])
    await expect(plugin.search('测试', badJson.ctx)).rejects.toThrow()

    const apiErr = makeCtx([{ match: '/api/Core/search2', respond: { code: 1, msg: 'denied', data: '' } }])
    await expect(plugin.search('测试', apiErr.ctx)).rejects.toThrow(/denied/)
  })

  it('关键词不匹配的结果被过滤', async () => {
    const { ctx } = makeCtx([{ match: '/api/Core/search2', respond: ok(page()) }])
    expect(await plugin.search('完全不相关', ctx)).toEqual([])
  })
})

describe('yunso decryptUrl / parseItems', () => {
  it('直链、纯 base64、非法输入', () => {
    expect(decryptUrl('https://a.com/x?')).toBe('https://a.com/x')
    expect(decryptUrl('https://a.com/x?#f')).toBe('https://a.com/x#f')
    expect(decryptUrl('https://a.com/x?a=1&amp;b=2')).toBe('https://a.com/x?a=1&b=2')
    expect(decryptUrl(btoa('https://a.com/y'))).toBe('https://a.com/y')
    expect(() => decryptUrl('')).toThrow()
    expect(() => decryptUrl('***')).toThrow()
  })

  it('parseItems 提取字段', () => {
    const items = parseItems(page())
    expect(items).toHaveLength(5)
    expect(items[0]).toMatchObject({ fullId: 'sid1', qid: 'q1', typeCode: '20500', fileSummary: '12个文件 & 3.5GB' })
    expect(items[3]!.fileSummary).toBe('')
    expect(items[4]!.url).toBe('')
  })
})
