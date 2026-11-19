import type { SearchResult } from '../types'
import { parseTime } from '../core/time'
import { definePlugin, makeResult, type LinkInput } from './types'

// 爱看：PanSou 兼容聚合 API，结果基本直通，仅校验链接类型与 URL 形态
const SEARCH_API = 'https://api.naspt.vip/api/open/pansou/search'
const REFERER = 'https://api.naspt.vip/'
const LIMIT = 50
const NAME = 'ikantv'

const ALLOWED_PANS = new Set([
  'quark', 'uc', 'baidu', 'aliyun', 'guangya', 'xunlei', 'tianyi', '115', '123', 'mobile', 'pikpak', 'magnet', 'ed2k',
])

interface ApiLink {
  type?: string
  url?: string
  password?: string
  datetime?: string
  work_title?: string
}

interface ApiItem {
  message_id?: string
  unique_id?: string
  datetime?: string
  title?: string
  content?: string
  tags?: string[] | null
  images?: string[] | null
  links?: ApiLink[] | null
}

interface ApiResp {
  code?: number
  message?: string
  data?: ApiItem[] | null
}

function isValidUrl(pan: string, raw: string): boolean {
  const lower = raw.toLowerCase()
  if (pan === 'magnet') return lower.startsWith('magnet:?')
  if (pan === 'ed2k') return lower.startsWith('ed2k://')
  try {
    const u = new URL(raw)
    return u.host !== '' && u.protocol.startsWith('http')
  } catch {
    return false
  }
}

function convertLinks(raw: ApiLink[]): LinkInput[] {
  const links: LinkInput[] = []
  for (const l of raw) {
    const pan = (l.type ?? '').trim().toLowerCase()
    if (!ALLOWED_PANS.has(pan)) continue
    const href = (l.url ?? '').trim()
    if (!href || !isValidUrl(pan, href)) continue
    links.push({
      type: pan,
      url: href,
      password: l.password ?? '',
      datetime: parseTime(l.datetime),
      workTitle: l.work_title,
    })
  }
  return links
}

/** 对应 Go 的 FilterResultsByKeyword：每个空白分隔的关键词都须出现在标题或内容里。 */
function matchesKeyword(title: string, content: string, keyword: string): boolean {
  const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  const t = title.toLowerCase()
  const c = content.toLowerCase()
  return kws.every((k) => t.includes(k) || c.includes(k))
}

export default definePlugin({
  name: NAME,
  priority: 3,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    let url = `${SEARCH_API}?kw=${encodeURIComponent(keyword)}&limit=${LIMIT}`
    const titleEn = ctx.ext.title_en
    if (typeof titleEn === 'string' && titleEn) url += `&title_en=${encodeURIComponent(titleEn)}`

    // Go 版重试 3 次（含首次），对应 retries=2；去掉了随机 UA 与退避睡眠之外的细节
    const resp = await ctx.http.json<ApiResp>(url, {
      headers: { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', Referer: REFERER },
      timeoutMs: 30000,
      retries: 2,
    })
    if (resp.code !== 0) throw new Error(`[${NAME}] API错误: ${resp.message ?? ''}`)

    const out: SearchResult[] = []
    for (const item of resp.data ?? []) {
      const links = convertLinks(item.links ?? [])
      if (links.length === 0) continue
      let id = (item.unique_id ?? '').trim() || (item.message_id ?? '').trim()
      if (!id) continue
      if (id.startsWith(`${NAME}-`)) id = id.slice(NAME.length + 1)
      const r = makeResult({
        plugin: NAME,
        id,
        title: item.title ?? '',
        content: item.content ?? '',
        datetime: parseTime(item.datetime),
        links,
        tags: item.tags ?? [],
        images: item.images ?? [],
      })
      r.message_id = item.message_id ?? ''
      if (matchesKeyword(r.title, r.content, keyword)) out.push(r)
    }
    return out
  },
})
