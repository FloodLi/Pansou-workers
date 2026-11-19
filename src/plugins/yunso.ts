import { mapLimit } from '../core/pool'
import { parseTime } from '../core/time'
import { unescapeHtml } from '../core/html'
import { getLinkType } from '../links'
import { ZERO_TIME, type SearchResult } from '../types'
import { definePlugin, makeResult } from './types'

const NAME = 'yunso'
const SEARCH_API = 'https://www.yunso.net/api/Core/search2'
const SEARCH_PAGE = 'https://www.yunso.net/index/user/s'
const ORIGIN = 'https://www.yunso.net'
const DECRYPT_KEY = 'pWz1vnL1fTkOvTMW3f9M1jJWfneUIh50'
const MODE = '90002'
const SCOPE = '0'
const PAGE_SIZE = 20
const MAX_PAGES = 3
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

const KEY_BYTES = new TextEncoder().encode(DECRYPT_KEY)
const DATETIME_RE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
const TYPE_CODE_RE = /\/assets\/xyso\/(\d+)\.png/

interface YunsoItem {
  fullId: string
  qid: string
  title: string
  url: string
  password: string
  typeCode: string
  typeName: string
  preview: string
  fileSummary: string
  datetime: string
  badges: string[]
}

interface YunsoResp {
  code: number
  msg: string
  data: string
}

// ---------- 文本/属性辅助（用正则而非 DOM，省 CPU） ----------

function cleanText(v: string): string {
  return unescapeHtml(v).split(/\s+/).filter(Boolean).join(' ').trim()
}

function stripTags(html: string): string {
  // 等价 goquery .Text()：去标签并解实体
  return unescapeHtml(html.replace(/<[^>]*>/g, ''))
}

function attr(tag: string, name: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  return m ? unescapeHtml(m[1] ?? m[2] ?? '') : ''
}

function hasClass(tag: string, ...classes: string[]): boolean {
  const tokens = attr(tag, 'class').split(/\s+/)
  return classes.every((c) => tokens.includes(c))
}

/** 在片段内找第一个满足条件的开始标签，返回其文本与结束位置。 */
function findTag(html: string, name: string, pred: (tag: string) => boolean): { tag: string; end: number } | null {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (pred(m[0])) return { tag: m[0], end: m.index + m[0].length }
  }
  return null
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const c = cleanText(v)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

// ---------- URL 解密 ----------

function normalizeUrl(value: string): string {
  const v = value.trim()
  // 去除上游模板留下的空查询符（保留片段），对应 Go 的 ForceQuery 处理
  const m = v.match(/^([^?#]*)\?(#.*)?$/)
  return m ? (m[1] ?? '') + (m[2] ?? '') : v
}

function decodeBase64(value: string): Uint8Array {
  const v = value.trim()
  if (!v) throw new Error('empty encrypted url')
  // atob 对缺失的 padding 宽容，无需像 Go 那样补 '='
  const bin = atob(v)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function decryptUrl(input: string): string {
  const value = unescapeHtml(input).trim()
  if (!value) throw new Error('empty encrypted url')
  // 新版直接给 URL；旧版 base64 / base64+XOR 路径保留
  if (/^https?:\/\//i.test(value)) return normalizeUrl(value)

  const decoded = decodeBase64(value)
  const dec = new TextDecoder()
  const rawText = dec.decode(decoded).trim()
  if (rawText.startsWith('http://') || rawText.startsWith('https://')) return normalizeUrl(rawText)

  // 按字节异或（UTF-8 字节语义），最后再整体按 UTF-8 解码
  const out = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) out[i] = (decoded[i] as number) ^ (KEY_BYTES[i % KEY_BYTES.length] as number)
  return normalizeUrl(dec.decode(out))
}

function extractPasswordFromUrl(raw: string): string {
  if (!raw) return ''
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return ''
  }
  for (const key of ['pwd', 'pass', 'password']) {
    const v = (u.searchParams.get(key) ?? '').trim()
    if (v) return v
  }
  return ''
}

// ---------- 解析 ----------

export function parseItems(fragment: string): YunsoItem[] {
  // 按 div.layui-card[data-qid] 的开始标签切块
  const starts: { tag: string; index: number }[] = []
  const divRe = /<div\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = divRe.exec(fragment))) {
    if (hasClass(m[0], 'layui-card') && /\sdata-qid\s*=/i.test(m[0])) starts.push({ tag: m[0], index: m.index })
  }

  const items: YunsoItem[] = []
  starts.forEach((s, n) => {
    const chunk = fragment.slice(s.index, starts[n + 1]?.index ?? fragment.length)

    const lower = chunk.toLowerCase()
    const anchorRe = /<a\b[^>]*>/gi
    let am: RegExpExecArray | null
    let anchorTag = ''
    let anchorEnd = 0
    while ((am = anchorRe.exec(chunk))) {
      if (/\sonclick\s*=\s*(?:"[^"]*open_sid[^"]*"|'[^']*open_sid[^']*')/i.test(am[0])) {
        anchorTag = am[0]
        anchorEnd = am.index + am[0].length
        break
      }
    }
    if (!anchorTag) return

    const closeIdx = lower.indexOf('</a>', anchorEnd)
    const title = cleanText(stripTags(chunk.slice(anchorEnd, closeIdx < 0 ? undefined : closeIdx)))
    if (!title) return

    const encryptedUrl = attr(anchorTag, 'url')
    let url = ''
    if (encryptedUrl) {
      try {
        url = decryptUrl(encryptedUrl)
      } catch {
        // 解密失败视为无链接，与 Go 一致（后续被丢弃）
      }
    }

    const bodyTag = findTag(chunk, 'div', (t) => hasClass(t, 'layui-card-body'))
    let fileSummary = ''
    if (bodyTag) {
      const sp = chunk.slice(bodyTag.end).match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)
      fileSummary = cleanText(stripTags(sp?.[1] ?? ''))
    }
    if (fileSummary.toUpperCase().includes('N/A')) fileSummary = ''

    const pTag = findTag(chunk, 'p', (t) => hasClass(t, 'result', 'container', 'p'))
    let preview = ''
    if (pTag) {
      const end = lower.indexOf('</p>', pTag.end)
      preview = cleanText(stripTags(chunk.slice(pTag.end, end < 0 ? undefined : end)))
    }

    const headerTag = findTag(chunk, 'div', (t) => hasClass(t, 'layui-card-header'))
    let headerText = ''
    if (headerTag) {
      const end = lower.indexOf('</div>', headerTag.end)
      headerText = stripTags(chunk.slice(headerTag.end, end < 0 ? undefined : end))
    }
    const dt = headerText.match(DATETIME_RE)?.[0]

    const img = findTag(chunk, 'img', (t) => attr(t, 'src').includes('/assets/xyso/'))
    const imgSrc = img ? attr(img.tag, 'src') : ''

    const badges: string[] = []
    const badgeRe = /<(\w+)\b[^>]*>/g
    let bm: RegExpExecArray | null
    while ((bm = badgeRe.exec(chunk))) {
      if (!bm[0].includes('badge') || !hasClass(bm[0], 'badge')) continue
      const end = lower.indexOf(`</${(bm[1] as string).toLowerCase()}>`, bm.index + bm[0].length)
      const text = cleanText(stripTags(chunk.slice(bm.index + bm[0].length, end < 0 ? undefined : end)))
      if (text) badges.push(text)
    }

    const item: YunsoItem = {
      title,
      url,
      preview,
      fileSummary,
      datetime: dt ? parseTime(dt) : ZERO_TIME,
      typeName: cleanText(img ? attr(img.tag, 'alt') : ''),
      typeCode: imgSrc.match(TYPE_CODE_RE)?.[1] ?? '',
      password: cleanText(attr(anchorTag, 'pa')),
      fullId: attr(anchorTag, 'id').trim(),
      qid: attr(s.tag, 'data-qid').trim(),
      badges: uniqueStrings(badges),
    }
    if (!item.password) item.password = extractPasswordFromUrl(item.url)
    items.push(item)
  })
  return items
}

function score(item: YunsoItem): number {
  let s = 0
  if (item.url) s += 8
  if (item.password) s += 5
  if (item.datetime !== ZERO_TIME) s += 3
  if (item.fileSummary) s += 2
  if (item.preview) s += 2
  if (item.typeCode) s += 1
  return s
}

function dedupe(items: YunsoItem[]): YunsoItem[] {
  const map = new Map<string, YunsoItem>()
  for (const item of items) {
    const key = item.url || item.fullId || `${item.qid}|${item.title}`
    const existing = map.get(key)
    if (!existing || score(item) > score(existing)) map.set(key, item)
  }
  return [...map.values()]
}

const TYPE_MAP: Record<string, string> = {
  '1': 'baidu',
  '20100': 'aliyun',
  '20500': 'quark',
  '20000': 'tianyi',
  '20300': 'mobile',
  '20400': 'xunlei',
  '20501': 'uc',
  '20600': 'lanzou',
}

function mapDiskType(typeCode: string, rawUrl: string): string {
  const mapped = TYPE_MAP[typeCode.trim()]
  if (mapped) return mapped
  const lower = rawUrl.trim().toLowerCase()
  if (lower.includes('uc.cn')) return 'uc'
  return getLinkType(lower)
}

function convert(items: YunsoItem[]): SearchResult[] {
  const results: SearchResult[] = []
  items.forEach((item, i) => {
    if (!item.url.trim()) return
    const parts: string[] = []
    if (item.preview) parts.push(item.preview)
    if (item.fileSummary) parts.push(item.fileSummary)
    if (item.typeName) parts.push(`网盘: ${item.typeName}`)
    results.push(
      makeResult({
        plugin: NAME,
        id: item.fullId || `${item.qid}-${i}`,
        title: item.title,
        content: parts.join('\n'),
        datetime: item.datetime,
        links: [{ url: item.url, type: mapDiskType(item.typeCode, item.url), password: item.password, datetime: item.datetime }],
        tags: uniqueStrings([item.typeName, ...item.badges]),
      }),
    )
  })
  return results
}

// 等价 Go plugin.FilterResultsByKeyword
function filterByKeyword(results: SearchResult[], keyword: string): SearchResult[] {
  if (!keyword) return results
  const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  return results.filter((r) => {
    const t = r.title.toLowerCase()
    const c = r.content.toLowerCase()
    return kws.every((kw) => t.includes(kw) || c.includes(kw))
  })
}

export default definePlugin({
  name: NAME,
  priority: 3,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    const pages = Array.from({ length: MAX_PAGES }, (_, i) => i + 1)
    // Go 版同样并发 3 页；单页失败不影响其它页，全部为空且有失败时才抛错
    const settled = await mapLimit(pages, MAX_PAGES, async (page) => {
      // 参数按键名字典序，与 Go url.Values.Encode 一致
      const qs = new URLSearchParams()
      qs.set('limit', String(PAGE_SIZE))
      qs.set('mode', MODE)
      qs.set('page', String(page))
      qs.set('requestID', '')
      qs.set('scope_content', SCOPE)
      qs.set('screen_filetype', '')
      qs.set('stype', '')
      qs.set('uk', '')
      qs.set('wd', keyword)
      const referer = `${SEARCH_PAGE}?${new URLSearchParams({ wd: keyword }).toString()}`
      const resp = await ctx.http.json<YunsoResp>(`${SEARCH_API}?${qs.toString()}`, {
        method: 'POST',
        retries: 0,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Origin: ORIGIN,
          Referer: referer,
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
        },
      })
      if (resp.code !== 0) throw new Error(`[${NAME}] api returned error: ${resp.msg}`)
      return parseItems(resp.data ?? '')
    })

    const all: YunsoItem[] = []
    let firstErr: unknown
    for (const s of settled) {
      if (s.status === 'fulfilled') all.push(...s.value)
      else firstErr ??= s.reason
    }
    if (all.length === 0 && firstErr) throw firstErr
    return filterByKeyword(convert(dedupe(all)), keyword)
  },
})
