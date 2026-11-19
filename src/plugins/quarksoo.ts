import { parseHtml, textOf } from '../core/html'
import { cleanText, fields, filterByKeyword, hash16, queryEscape } from './_helpers/text'
import { definePlugin, makeResult } from './types'
import type { SearchResult } from '../types'

const SEARCH_URL = 'https://quarksoo.cc/search.php'
const REFERER = 'https://quarksoo.cc/'
const MAX_RETRIES = 2

export default definePlugin({
  name: 'quarksoo',
  priority: 3,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    // 删除了随机 UA / 伪造 XFF（Workers 里会被覆盖），重试间隔交给 ctx.http
    const html = await ctx.http.text(`${SEARCH_URL}?q=${queryEscape(keyword)}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: REFERER,
      },
      retries: MAX_RETRIES,
    })

    const results = parseResults(html, keyword)
    // 以 UniqueID 去重，再按标题排序保持稳定
    const seen = new Set<string>()
    const unique = results.filter((r) => (seen.has(r.unique_id) ? false : (seen.add(r.unique_id), true)))
    unique.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    return filterByKeyword(unique, keyword)
  },
})

function parseResults(html: string, keyword: string): SearchResult[] {
  const kws = fields(keyword.toLowerCase())
  const out: SearchResult[] = []
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  for (const row of parseHtml(html).querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 2) continue
    const title = cleanText(textOf(cells[0]))
    if (!title || title.includes('剧名') || title.includes('网盘链接')) continue

    const anchor = cells[1]?.querySelector('a[href]') ?? row.querySelector('a[href]')
    const url = (anchor?.getAttribute('href') ?? '').trim()
    const lower = url.toLowerCase()
    // pan.qoark.cn 是 Go 版保留的站点笔误域名，照搬
    if (!lower.includes('pan.qoark.cn') && !lower.includes('pan.quark.cn')) continue

    const lowerTitle = title.toLowerCase()
    if (!kws.every((k) => lowerTitle.includes(k))) continue

    out.push(
      makeResult({
        plugin: 'quarksoo',
        id: hash16(`${title}|${url}`),
        title,
        datetime: now,
        links: [{ url, type: 'quark', password: '' }],
      }),
    )
  }
  return out
}
