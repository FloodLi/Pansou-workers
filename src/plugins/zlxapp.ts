import { extractArrayLiteral } from './_helpers/jsLiteral'
import { cleanText, filterByKeyword, normalizeNetdiskLink, parseYmdOrNow, pathEscape } from './_helpers/text'
import { definePlugin, makeResult } from './types'
import type { SearchResult } from '../types'

const BASE_URL = 'https://www.zlxapp.top'
const MAX_RESPONSE_BYTES = 2 << 20
const MAX_RETRIES = 2
const MARKER = 'const listItemsData = '

interface SourceLink {
  url?: string | null
  code?: string | null
  target_name?: string | null
  source_title?: string | null
  status?: number
  is_delete?: number
}

interface Item {
  id?: number
  title?: string | null
  description?: string | null
  code?: string | null
  url?: string | null
  times?: string | null
  category?: { name?: string } | null
  tag_names?: string[] | null
  links?: SourceLink[] | null
}

export default definePlugin({
  name: 'zlxapp',
  priority: 3,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    keyword = cleanText(keyword)
    if (!keyword) return []
    // Go 版 maxRetries=2（共 3 次尝试），与计划里最坏 3 个子请求一致
    const html = await ctx.http.text(`${BASE_URL}/s/${pathEscape(keyword)}.html`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        Referer: `${BASE_URL}/`,
      },
      maxBytes: MAX_RESPONSE_BYTES,
      retries: MAX_RETRIES,
    })

    const literal = extractArrayLiteral(html, MARKER)
    if (literal === null) throw new Error('[zlxapp] 解析搜索结果失败: 未找到 listItemsData')
    let items: Item[]
    try {
      const parsed: unknown = JSON.parse(literal)
      items = Array.isArray(parsed) ? (parsed as Item[]) : []
    } catch {
      throw new Error('[zlxapp] 解析搜索结果失败: 数组 JSON 非法')
    }

    const results: SearchResult[] = []
    for (const item of items) {
      const r = convertItem(item)
      if (r) results.push(r)
    }
    return filterByKeyword(dedupe(results), keyword)
  },
})

function convertItem(item: Item): SearchResult | null {
  const title = cleanText(item.title ?? '')
  const id = item.id ?? 0
  if (!title || id <= 0) return null

  let sources = item.links ?? []
  if (sources.length === 0 && (item.url ?? '').trim()) {
    sources = [{ url: item.url, code: item.code, source_title: title, status: 1 }]
  }

  const links: { url: string; type: string; password: string; workTitle: string }[] = []
  const seen = new Set<string>()
  for (const s of sources) {
    if ((s.is_delete ?? 0) !== 0 || (s.status ?? 0) < 0) continue
    const n = normalizeNetdiskLink(s.url ?? '', s.code ?? '', (host) =>
      host === 'guangyapan.com' || host.endsWith('.guangyapan.com') ? 'guangya' : '',
    )
    if (!n) continue
    const key = `${n.url}\0${n.password}`
    if (seen.has(key)) continue
    seen.add(key)
    const workTitle = cleanText(s.target_name ?? '') || cleanText(s.source_title ?? '') || title
    links.push({ url: n.url, type: n.type, password: n.password, workTitle })
  }
  if (links.length === 0) return null

  const tags = [...(item.tag_names ?? [])]
  const cat = item.category?.name
  if (cat && !tags.includes(cat)) tags.push(cat)

  return makeResult({
    plugin: 'zlxapp',
    id: String(id),
    title,
    content: cleanText(item.description ?? '') || title,
    datetime: parseYmdOrNow(item.times ?? ''),
    links,
    tags,
  })
}

/** 以全部链接（url+口令）的组合为键去重，保留首个。 */
function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter((r) => {
    const key = r.links.map((l) => `${l.url}\0${l.password}`).join('\x01')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
