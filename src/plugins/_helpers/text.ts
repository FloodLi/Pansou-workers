// haitunsou / zlxapp / quarksoo / yunsou 共用的小工具（均为同步、无依赖）。
import { unescapeHtml } from '../../core/html'
import { parseTime } from '../../core/time'
import type { SearchResult } from '../../types'

/** 等价 Go strings.Fields：按空白切分。 */
export function fields(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}

/** 等价 Go strings.Join(strings.Fields(html.UnescapeString(strings.TrimSpace(v))), " ")。 */
export function cleanText(v: string): string {
  return fields(unescapeHtml(v.trim())).join(' ')
}

/** 等价 Go url.PathEscape（保留 $&+=:@，转义 , ; / ? 以及 !'()*）。 */
export function pathEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(24|26|2B|3D|3A|40)/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** 等价 Go url.QueryEscape（空格转 +，仅保留字母数字与 -_.~）。 */
export function queryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+')
}

/** 稳定同步字符串哈希（两路 32 位 FNV-1a 拼成 16 位十六进制），替代 Go 里的 md5/sha256 生成 UniqueID。 */
export function hash16(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (const x of bytes) {
    a = Math.imul(a ^ x, 0x01000193) >>> 0
    b = Math.imul(b ^ x, 0x85ebca6b) >>> 0
    b ^= b >>> 13
  }
  return a.toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** Go 的 time.Now()（RFC3339，秒精度）。原插件在时间解析失败时回落到当前时间。 */
export function nowRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** 严格解析 YYYY-MM-DD（对应 Go time.Parse("2006-01-02")），失败回落到当前时间。 */
export function parseYmdOrNow(v: string): string {
  const s = v.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseTime(s) : nowRfc3339()
}

/** 等价 plugin.FilterResultsByKeyword：关键词按空白拆分，每个词都需出现在标题或内容里（不区分大小写）。 */
export function filterByKeyword(results: SearchResult[], keyword: string): SearchResult[] {
  if (!keyword) return results
  const kws = fields(keyword.toLowerCase())
  return results.filter((r) => {
    const t = r.title.toLowerCase()
    const c = r.content.toLowerCase()
    return kws.every((k) => t.includes(k) || c.includes(k))
  })
}

export interface NetdiskLink {
  type: string
  url: string
  password: string
}

/** haitunsou / zlxapp 共用的链接规范化：只认 http(s) 与白名单域名，口令取声明值，否则取 URL 查询参数。 */
export function normalizeNetdiskLink(rawUrl: string, declaredPassword: string, extraHosts?: (host: string) => string): NetdiskLink | null {
  let u: URL
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  let type = ''
  if (host === 'pan.quark.cn') type = 'quark'
  else if (host === 'www.aliyundrive.com' || host === 'aliyundrive.com' || host === 'www.alipan.com' || host === 'alipan.com') type = 'aliyun'
  else if (host === 'pan.baidu.com') type = 'baidu'
  else if (host === 'drive.uc.cn') type = 'uc'
  else if (host === 'pan.xunlei.com') type = 'xunlei'
  else if (extraHosts) type = extraHosts(host)
  if (!type) return null
  let password = declaredPassword.trim()
  if (!password) {
    for (const k of ['pwd', 'password', 'code']) {
      const v = (u.searchParams.get(k) ?? '').trim()
      if (v) {
        password = v
        break
      }
    }
  }
  return { type, url: rawUrl.trim(), password }
}
