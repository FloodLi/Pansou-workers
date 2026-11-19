// fixture 为合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import { buildFlarumUrl, fetchFlarumDiscussions, filterByKeyword } from '../../src/plugins/_helpers/flarum'
import { fixture, makeCtx } from '../helpers/mockFetch'

describe('flarum helper', () => {
  it('构造 URL 并合并 posts（忽略同 id 的 users）', async () => {
    const { ctx, mock } = makeCtx([{ match: '/api/discussions', respond: fixture('quark4k/api.json') }])
    const ds = await fetchFlarumDiscussions(ctx, { base: 'https://x.test', keyword: 'a b', include: 'mostRelevantPost', limit: 50, offset: 50 })
    expect(ds).toHaveLength(3)
    expect(ds[0]!.contentHtml).toContain('pan.quark.cn/s/aaa111')
    const u = new URL(mock.calls[0]!.url)
    expect(u.searchParams.get('filter[q]')).toBe('a b')
    expect(u.searchParams.get('page[offset]')).toBe('50')
    expect(u.searchParams.get('page[limit]')).toBe('50')
  })
  it('无 offset 时不带 page[offset]', () => {
    expect(buildFlarumUrl({ base: 'https://x', keyword: 'k', include: 'i', limit: 5 })).not.toContain('offset')
  })
  it('非法 JSON 抛错', async () => {
    const { ctx } = makeCtx([{ match: '/api/', respond: 'not json' }])
    await expect(fetchFlarumDiscussions(ctx, { base: 'https://x.test', keyword: 'k', include: 'i', limit: 1 })).rejects.toThrow()
  })
  it('filterByKeyword 标题或内容命中', () => {
    const items = [{ title: 'Abc', content: '' }, { title: 'x', content: 'ABC' }, { title: 'x', content: 'y' }]
    expect(filterByKeyword(items, 'abc')).toHaveLength(2)
    expect(filterByKeyword(items, '')).toHaveLength(3)
  })
})
