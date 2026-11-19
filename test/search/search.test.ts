import { describe, expect, it } from 'vitest'
import { applyResultFilter } from '../../src/search/filter'
import { completenessScore, generateResultKey, mergeSearchResults } from '../../src/search/merge'
import { mergeResultsByType } from '../../src/search/mergeByType'
import { calculateTimeScore, getKeywordPriority, getResultSource, sortResults } from '../../src/search/rank'
import { cleanTitle, cutTitleByKeywords, extractLinkTitlePairs, isLinkPrefix } from '../../src/search/titles'
import { ZERO_TIME, type SearchResult } from '../../src/types'

function res(p: Partial<SearchResult>): SearchResult {
  return {
    message_id: '',
    unique_id: '',
    channel: '',
    datetime: ZERO_TIME,
    title: '',
    content: '',
    links: [],
    ...p,
  }
}
const link = (url: string, type = 'quark', extra: object = {}) => ({ type, url, password: '', datetime: ZERO_TIME, ...extra })

describe('merge', () => {
  it('key 优先级：unique_id > message_id > title+channel', () => {
    expect(generateResultKey(res({ unique_id: 'a-1', message_id: 'm' }))).toBe('a-1')
    expect(generateResultKey(res({ message_id: 'm' }))).toBe('m')
    expect(generateResultKey(res({ title: 't', channel: 'c' }))).toBe('title_t_c')
  })

  it('完整度打分按 Go 规则（标题长度按 UTF-8 字节）', () => {
    // unique_id 10 + 链接 5+2 + 内容 3 + 标题 "测试标题测试"(18字节)/10=1 + 频道 2 + 标签 2 = 25
    const r = res({ unique_id: 'x-1', links: [link('a'), link('b')], content: 'c', title: '测试标题测试', channel: 'ch', tags: ['1', '2'] })
    expect(completenessScore(r)).toBe(25)
  })

  it('同 key 取更完整者，结果按时间降序', () => {
    const a = res({ unique_id: 'p-1', title: 'a', datetime: '2024-01-01T00:00:00Z', links: [link('u1')] })
    const better = res({ unique_id: 'p-1', title: 'a', datetime: '2024-01-01T00:00:00Z', links: [link('u1'), link('u2')], content: 'x' })
    const newer = res({ unique_id: 'p-2', datetime: '2025-01-01T00:00:00Z', links: [link('u3')] })
    const out = mergeSearchResults([a], [better, newer])
    expect(out.map((r) => r.unique_id)).toEqual(['p-2', 'p-1'])
    expect(out[1]?.links.length).toBe(2)
  })
})

describe('rank', () => {
  it('关键词优先级', () => {
    expect(getKeywordPriority('xx合集')).toBe(7 * 70 - 0)
    expect(getKeywordPriority('xx 全 集')).toBe(5 * 70)
    expect(getKeywordPriority('普通')).toBe(0)
    expect(getKeywordPriority('COMPLETE edition')).toBe(1 * 70)
  })

  it('时间分档', () => {
    const now = Date.parse('2025-06-01T00:00:00Z')
    const d = (days: number) => new Date(now - days * 86_400_000).toISOString()
    expect([0.5, 2, 5, 20, 60, 200, 400].map((n) => calculateTimeScore(d(n), now))).toEqual([500, 400, 300, 200, 100, 50, 20])
    expect(calculateTimeScore(ZERO_TIME, now)).toBe(0)
  })

  it('来源推断', () => {
    expect(getResultSource(res({ channel: 'abc' }))).toBe('tg:abc')
    expect(getResultSource(res({ unique_id: 'wanou-123-4' }))).toBe('plugin:wanou')
    expect(getResultSource(res({ unique_id: 'nodash' }))).toBe('unknown')
  })

  it('插件等级加权：等级1 > 时间更新的等级3', () => {
    const now = Date.parse('2025-06-01T00:00:00Z')
    const old1 = res({ unique_id: 'hi-1', datetime: '2024-01-01T00:00:00Z' })
    const new3 = res({ unique_id: 'lo-1', datetime: '2025-05-31T12:00:00Z' })
    const list = [new3, old1]
    sortResults(list, (s) => (s === 'plugin:hi' ? 1 : 3), now)
    expect(list[0]?.unique_id).toBe('hi-1')
  })
})

describe('titles', () => {
  it('cleanTitle 去前缀与 emoji', () => {
    expect(cleanTitle('名称：🎬 流浪地球')).toBe('流浪地球')
    expect(cleanTitle('标题:abc')).toBe('abc')
  })
  it('cutTitleByKeywords', () => {
    expect(cutTitleByKeywords('电影A 简介 xxx 描述', ['简介', '描述'])).toBe('电影A')
    expect(cutTitleByKeywords('简介开头', ['简介'])).toBe('简介开头')
  })
  it('isLinkPrefix 识别网盘名', () => {
    expect(isLinkPrefix('夸克')).toBe(true)
    expect(isLinkPrefix('流浪地球')).toBe(false)
  })
  it('多行：标题行 + 链接行', () => {
    const m = extractLinkTitlePairs('流浪地球\n链接：https://pan.quark.cn/s/aaa\n三体\n链接：https://pan.quark.cn/s/bbb')
    expect(m.get('https://pan.quark.cn/s/aaa')).toBe('流浪地球')
    expect(m.get('https://pan.quark.cn/s/bbb')).toBe('三体')
  })
  it('多行："标题：链接" 格式', () => {
    const m = extractLinkTitlePairs('资源汇总\n流浪地球：https://pan.quark.cn/s/aaa')
    expect(m.get('https://pan.quark.cn/s/aaa')).toBe('流浪地球')
  })
  it('无换行时走正则分段路径（与 Go 一致，标题保留尾部冒号）', () => {
    const m = extractLinkTitlePairs('流浪地球：https://pan.quark.cn/s/aaa')
    expect(m.get('https://pan.quark.cn/s/aaa')).toBe('流浪地球：')
  })
})

describe('mergeResultsByType', () => {
  const tg = res({
    channel: 'ch1',
    unique_id: 'ch1_1',
    title: '流浪地球2',
    content: '流浪地球2\n链接：https://pan.quark.cn/s/aaa',
    datetime: '2024-05-01T00:00:00Z',
    links: [link('https://pan.quark.cn/s/aaa')],
    images: ['http://img/1.jpg'],
  })
  const plug = res({
    unique_id: 'wanou-9',
    title: '流浪地球2 简介：很好看',
    datetime: '2024-06-01T00:00:00Z',
    links: [link('https://pan.baidu.com/s/bbb', 'baidu', { password: '1234' })],
  })

  it('按类型分组，Note 裁剪"简介"，source 正确', () => {
    const m = mergeResultsByType([tg, plug], '流浪地球', undefined, () => false)
    expect(Object.keys(m).sort()).toEqual(['baidu', 'quark'])
    expect(m.baidu?.[0]).toMatchObject({ note: '流浪地球2', password: '1234', source: 'plugin:wanou' })
    expect(m.quark?.[0]).toMatchObject({ source: 'tg:ch1', images: ['http://img/1.jpg'] })
  })

  it('关键词过滤：标题不含关键词的插件链接被丢弃，除非 skipFilter', () => {
    const other = res({ unique_id: 'wanou-1', title: '完全无关', links: [link('https://pan.quark.cn/s/zzz')] })
    expect(mergeResultsByType([other], '流浪地球', undefined, () => false)).toEqual({})
    const kept = mergeResultsByType([other], '流浪地球', undefined, (n) => n === 'wanou')
    expect(kept.quark?.length).toBe(1)
  })

  it('TG 结果正文命中关键词也保留', () => {
    const t = res({ channel: 'c', title: '2024-05-01', content: '内含流浪地球资源', links: [link('https://pan.quark.cn/s/q1')] })
    expect(mergeResultsByType([t], '流浪地球', undefined, () => false).quark?.length).toBe(1)
  })

  it('同 URL 去重，保留时间更新者', () => {
    const a = res({ unique_id: 'a-1', title: '流浪地球', datetime: '2024-01-01T00:00:00Z', links: [link('https://pan.quark.cn/s/same')] })
    const b = res({ unique_id: 'b-1', title: '流浪地球', datetime: '2025-01-01T00:00:00Z', links: [link('https://pan.quark.cn/s/same')] })
    const m = mergeResultsByType([a, b], '流浪地球', undefined, () => false)
    expect(m.quark?.length).toBe(1)
    expect(m.quark?.[0]?.source).toBe('plugin:b')
  })

  it('cloud_types 过滤（大小写/空白不敏感）', () => {
    const m = mergeResultsByType([tg, plug], '流浪地球', [' Baidu '], () => false)
    expect(Object.keys(m)).toEqual(['baidu'])
  })

  it('link.work_title 优先', () => {
    const r = res({ unique_id: 'x-1', title: '总标题', links: [link('https://pan.quark.cn/s/w', 'quark', { work_title: '分作品' })] })
    expect(mergeResultsByType([r], '分作品', undefined, () => false).quark?.[0]?.note).toBe('分作品')
  })
})

describe('applyResultFilter', () => {
  const resp = {
    total: 2,
    merged_by_type: {
      quark: [
        { url: 'u1', password: '', note: '流浪地球 4K', datetime: ZERO_TIME },
        { url: 'u2', password: '', note: '流浪地球 枪版', datetime: ZERO_TIME },
      ],
    },
  }
  it('exclude 任一命中即排除；include 至少命中一个', () => {
    const out = applyResultFilter(resp, { exclude: ['枪版'] }, 'merged_by_type')
    expect(out.merged_by_type?.quark?.map((l) => l.url)).toEqual(['u1'])
    expect(out.total).toBe(1)
    const inc = applyResultFilter(resp, { include: ['4k'] }, 'merged_by_type')
    expect(inc.merged_by_type?.quark?.map((l) => l.url)).toEqual(['u1'])
  })
  it('空 filter 原样返回', () => {
    expect(applyResultFilter(resp, {}, 'merged_by_type')).toBe(resp)
  })
  it('results：按 title 与 work_title 过滤，无链接的结果被丢弃', () => {
    const r = res({ title: '合集', links: [link('a', 'quark', { work_title: '甲' }), link('b', 'quark', { work_title: '乙' })] })
    const out = applyResultFilter({ total: 1, results: [r] }, { exclude: ['乙'] }, 'results')
    expect(out.results?.[0]?.links.map((l) => l.url)).toEqual(['a'])
    const none = applyResultFilter({ total: 1, results: [r] }, { exclude: ['合集'] }, 'results')
    expect(none.results).toEqual([])
    expect(none.total).toBe(0)
  })
})
