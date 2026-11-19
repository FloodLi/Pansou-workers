import type { SearchResult } from '../types'
import { parseTime } from '../core/time'
import { getLinkType } from '../links'
import { definePlugin, makeResult } from './types'

const NAME = 'meitizy'
// 前端与 API 分属不同域名
const BASE_URL = 'https://apis.451024.xyz'
const FRONTEND_URL = 'https://video.451024.xyz'
const SEARCH_PATH = '/api/media/search'
const PAGE_SIZE = 10 // 新版 API 仅接受网页使用的 size=10

interface ApiItem {
  id?: number | string
  title?: string
  content?: string
  link?: string
  link_type?: string
  tags?: string
  created_at?: string
  updated_at?: string
}

interface ApiResp {
  data?: ApiItem[] | null
}

const LINK_TYPES: Record<string, string> = {
  alipan: 'aliyun',
  xunlei: 'xunlei',
  baidu: 'baidu',
  quark: 'quark',
  uc: 'uc',
  '115': '115',
  '123': '123',
  tianyi: 'tianyi',
  mobile: 'mobile',
  pikpak: 'pikpak',
}

/** 要求有 scheme 与 host（与 Go 的 url.Parse 校验一致，magnet 因无 host 会被丢弃）。 */
function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw)
    return u.protocol && u.host ? u : null
  } catch {
    return null
  }
}

function passwordFromUrl(u: URL): string {
  for (const key of ['pwd', 'password', 'passcode', 'code']) {
    const v = (u.searchParams.get(key) ?? '').trim()
    if (v) return v
  }
  return ''
}

/** 对应 Go 的 FilterResultsByKeyword。 */
function matchesKeyword(title: string, content: string, keyword: string): boolean {
  const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  const t = title.toLowerCase()
  const c = content.toLowerCase()
  return kws.every((k) => t.includes(k) || c.includes(k))
}

export default definePlugin({
  name: NAME,
  priority: 2,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    // Go 版重试 3 次（含首次），对应 retries=2
    const resp = await ctx.http.json<ApiResp>(BASE_URL + SEARCH_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Origin: FRONTEND_URL,
        Referer: `${FRONTEND_URL}/`,
      },
      body: JSON.stringify({ title: keyword, page: 1, size: PAGE_SIZE }),
      timeoutMs: 30000,
      retries: 2,
    })

    const out: SearchResult[] = []
    for (const item of resp.data ?? []) {
      const link = (item.link ?? '').trim()
      if (!link) continue
      const parsed = parseUrl(link)
      if (!parsed) continue

      let datetime = parseTime(item.created_at)
      if (datetime.startsWith('0001')) datetime = parseTime(item.updated_at)
      if (datetime.startsWith('0001')) datetime = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

      let type = LINK_TYPES[(item.link_type ?? '').toLowerCase()] ?? 'others'
      if (type === 'others') type = getLinkType(link)

      const r = makeResult({
        plugin: NAME,
        id: String(item.id ?? ''),
        title: item.title ?? '',
        content: item.content ?? '',
        datetime,
        links: [{ url: link, type, password: passwordFromUrl(parsed) }],
        tags: item.tags ? [item.tags] : [],
      })
      if (matchesKeyword(r.title, r.content, keyword)) out.push(r)
    }
    return out
  },
})
