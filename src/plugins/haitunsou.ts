import { extractJsonParseString, parseJsonLenient } from './_helpers/jsLiteral'
import { cleanText, filterByKeyword, hash16, normalizeNetdiskLink, parseYmdOrNow, pathEscape } from './_helpers/text'
import { definePlugin, makeResult } from './types'

const BASE_URL = 'https://www.haitunsou.com'
const MAX_RESPONSE_BYTES = 3 << 20
const LIST_MARKERS = ["const list = JSON.parse('", "let listItems = JSON.parse('"]
// is_type 声明的类型必须与域名推断的一致，否则丢弃
const DECLARED_TYPES: Record<number, string> = { 0: 'quark', 1: 'aliyun', 2: 'baidu', 3: 'uc', 4: 'xunlei' }

interface Item {
  id?: number
  title?: string | null
  is_type?: number
  code?: string | null
  url?: string | null
  name?: string | null
  times?: string | null
}

function splitTitleAndDescription(value: string): [string, string] {
  let v = value.trim()
  for (const p of ['资源标题：', '资源标题:']) {
    if (v.startsWith(p)) v = v.slice(p.length).trim()
  }
  for (const m of ['资源描述：', '资源描述:']) {
    const i = v.indexOf(m)
    if (i >= 0) return [v.slice(0, i).trim(), v.slice(i + m.length).trim()]
  }
  return [v, '']
}

export default definePlugin({
  name: 'haitunsou',
  priority: 2,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    keyword = cleanText(keyword)
    if (!keyword) return []
    // 去掉了 Go 版的进程内缓存；仅 1 次请求，不重试以守住子请求预算
    const html = await ctx.http.text(`${BASE_URL}/s/${pathEscape(keyword)}.html`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        Referer: `${BASE_URL}/`,
      },
      maxBytes: MAX_RESPONSE_BYTES,
      retries: 0,
    })

    const decoded = extractJsonParseString(html, LIST_MARKERS)
    if (decoded === null) throw new Error('[haitunsou] 解析搜索结果失败: 未找到页面内嵌结果')
    let items: Item[]
    try {
      const parsed: unknown = parseJsonLenient(decoded)
      items = Array.isArray(parsed) ? (parsed as Item[]) : []
    } catch {
      throw new Error('[haitunsou] 解析搜索结果失败: 结果 JSON 非法')
    }

    const results = []
    const seen = new Set<string>()
    for (const item of items) {
      const rawTitle = cleanText(item.title ?? '') || cleanText(item.name ?? '')
      if (!rawTitle) continue
      const [title, description] = splitTitleAndDescription(rawTitle)
      if (!title) continue

      const link = normalizeNetdiskLink(item.url ?? '', item.code ?? '')
      if (!link) continue
      const expected = DECLARED_TYPES[item.is_type ?? -1]
      if (expected && expected !== link.type) continue

      const key = `${link.url}\0${link.password}`
      if (seen.has(key)) continue
      seen.add(key)

      const content = cleanText(item.name ?? '') || description || rawTitle
      const id = item.id && item.id > 0 ? String(item.id) : hash16(link.url)
      results.push(
        makeResult({
          plugin: 'haitunsou',
          id,
          title,
          content,
          datetime: parseYmdOrNow(item.times ?? ''),
          links: [{ url: link.url, type: link.type, password: link.password, workTitle: title }],
          tags: [link.type],
        }),
      )
    }
    return filterByKeyword(results, keyword)
  },
})
