// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取，真实站点是否匹配未验证
import { describe, expect, it } from 'vitest'
import feikuai from '../../src/plugins/feikuai'
import { expectValidPluginResults } from '../helpers/assertions'
import { fixture, makeCtx } from '../helpers/mockFetch'

const API = { match: 'bm_search.php' }
const WEB = { match: 'feikuai.in/vodsearch' }

describe('feikuai', () => {
  it('API 路径：磁力、work_title、标签、带时区时间', async () => {
    const { ctx, mock } = makeCtx([{ ...API, respond: fixture('feikuai/api.json') }])
    const res = await feikuai.search('流浪地球', ctx)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://feikuai.tv/t_search/bm_search.php?kw=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83')
    expect(res).toHaveLength(2)
    const a = res[0]!
    expect(a.unique_id).toBe('feikuai-abc123')
    expect(a.title).toBe('流浪地球.2160p.HEVC.HDR')
    expect(a.datetime).toBe('2025-11-18T00:54:20Z')
    expect(a.tags).toEqual(['4K', 'H265', 'HDR'])
    expect(a.content).toBe('文件名: 流浪地球.2160p.HEVC.HDR.mkv | 大小: 12.35 GB | 做种: 10 | 下载: 2 | 发布: 3天前')
    expect(a.links[0]).toMatchObject({ type: 'magnet', url: 'magnet:?xt=urn:btih:abc123', work_title: a.title })
    const b = res[1]!
    expect(b.title.startsWith('流浪地球-Wandering.Earth')).toBe(true)
    expect(b.datetime).toBe('2025-01-01T02:00:00Z') // +08 手工换算
    expectValidPluginResults(feikuai, res)
  })
  it('API 成功但无结果：返回空，不回退', async () => {
    const { ctx, mock } = makeCtx([{ ...API, respond: { code: 0, items: [] } }])
    expect(await feikuai.search('x', ctx)).toEqual([])
    expect(mock.calls).toHaveLength(1)
  })
  it('API 失败（500 / code!=0 / 非 JSON）回退网页解析', async () => {
    for (const api of [{ respond: 'e', status: 500 }, { respond: { code: 1, msg: 'bad' } }, { respond: 'not json' }]) {
      const { ctx, mock } = makeCtx([{ ...API, ...api }, { ...WEB, respond: fixture('feikuai/web.html') }])
      const res = await feikuai.search('流浪地球', ctx)
      expect(mock.calls.length).toBeLessThanOrEqual(4)
      expect(mock.calls.at(-1)!.url).toBe('https://feikuai.in/vodsearch/-------------.html?wd=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83&ext=1')
      expect(res).toHaveLength(2) // example.com 链接被丢弃
      const pan = res.find((r) => r.links[0]!.type === 'baidu')!
      expect(pan.links[0]!.password).toBe('wxyz')
      expect(pan.title).toBe('流浪地球 网盘')
      expect(pan.datetime).toBe('2026-08-16T13:11:58Z')
      expect(pan.unique_id).toMatch(/^feikuai-[0-9a-f]{16}$/)
      const mg = res.find((r) => r.links[0]!.type === 'magnet')!
      expect(mg.links[0]!.password).toBe('abcd')
      expect(mg.datetime).toBe('2026-01-02T00:00:00Z')
      expectValidPluginResults(feikuai, res)
    }
  })
  it('API 与网页都失败抛错，子请求不超过 4', async () => {
    const { ctx, mock } = makeCtx([{ ...API, respond: 'e', status: 500 }, { ...WEB, respond: 'e', status: 500 }])
    await expect(feikuai.search('x', ctx)).rejects.toThrow(/500/)
    expect(mock.calls.length).toBeLessThanOrEqual(4)
  })
  it('网页无有效资源抛错', async () => {
    const { ctx } = makeCtx([{ ...API, respond: 'e', status: 500 }, { ...WEB, respond: '<html></html>' }])
    await expect(feikuai.search('x', ctx)).rejects.toThrow(/没有有效资源/)
  })
})
