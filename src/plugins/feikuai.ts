import { BudgetExceeded } from '../core/budget'
import { errMsg } from '../core/http'
import { parseHtml, textOf } from '../core/html'
import { getLinkType } from '../links'
import { ZERO_TIME, type SearchResult } from '../types'
import { filterByKeyword, nowIso } from './_helpers/flarum'
import { definePlugin, makeResult, type PluginContext } from './types'

const SEARCH_API_URL = 'https://feikuai.tv/t_search/bm_search.php'
const SEARCH_WEB_URL = 'https://feikuai.in/vodsearch/-------------.html'

const FILE_EXT_RE = /\.(mkv|mp4|avi|rmvb|wmv|flv|mov|ts|m2ts|iso)$/
const FILE_SIZE_RE = /\s*·\s*[\d.]+\s*[KMGT]B\s*$/
const WEB_PWD_RE = /(?:提取码|密码|pwd)[:：]?\s*([a-z0-9]{4})/i
const WEB_TIME_RE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2})?/
const TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/

interface Torrent {
  info_hash?: string
  magnet?: string
  name?: string
  size_gb?: number
  seeders?: number
  leechers?: number
  published_at?: string
  published_ago?: string
}
interface ApiResp {
  code?: number
  msg?: string
  items?: { title?: string; torrents?: Torrent[] }[]
}

/** 同步字符串哈希（双 FNV-1a 变体拼 16 位 hex），只用于回退路径的 UniqueID，无需密码学强度。 */
function stableHash(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/**
 * 解析 "2025-11-18 00:54:20.659664+00" / "...+08" / 无时区（按 UTC，同 Go time.Parse）等格式。
 * 失败返回 ''。
 */
function parseIsoLike(s: string): string {
  const m = TIME_RE.exec(s.trim())
  if (!m) return ''
  let tz = m[4] ?? 'Z'
  if (tz !== 'Z') {
    const digits = tz.slice(1).replace(':', '')
    tz = `${tz[0]}${digits.slice(0, 2)}:${digits.slice(2) || '00'}`
  }
  const d = new Date(`${m[1]}T${m[2]}${m[3] ? `.${m[3].slice(0, 3).padEnd(3, '0')}` : ''}${tz}`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function splitKeywords(keyword: string): string[] {
  let parts = [keyword.trim()]
  for (const sep of [' ', '　', '，', '。', '、', '；', '：', '！', '？', '-', '_']) {
    parts = parts.flatMap((p) => p.split(sep))
  }
  // Go 按字节计长度（>=2），这里同样用 UTF-8 字节数，单个汉字(3 字节)也保留
  return parts.map((p) => p.trim()).filter((p) => new TextEncoder().encode(p).length >= 2)
}

function cleanFileName(name: string): string {
  let n = name.replace(FILE_EXT_RE, '').replace(FILE_SIZE_RE, '')
  const idx = n.indexOf('@')
  if (idx !== -1) n = n.slice(0, idx)
  return n.trim()
}

function buildWorkTitle(keyword: string, fileName: string): string {
  const cleaned = cleanFileName(fileName)
  const lower = cleaned.toLowerCase()
  return splitKeywords(keyword).some((k) => lower.includes(k.toLowerCase())) ? cleaned : `${keyword}-${cleaned}`
}

function extractTags(title: string, fileName: string): string[] {
  const t = `${title} ${fileName}`.toUpperCase()
  const tags: string[] = []
  if (t.includes('2160P') || t.includes('4K')) tags.push('4K')
  else if (t.includes('1080P')) tags.push('1080P')
  else if (t.includes('720P')) tags.push('720P')
  if (t.includes('H265') || t.includes('HEVC')) tags.push('H265')
  else if (t.includes('H264') || t.includes('AVC')) tags.push('H264')
  if (t.includes('HDR')) tags.push('HDR')
  if (t.includes('60FPS') || t.includes('60HZ')) tags.push('60fps')
  return tags
}

function parseApi(keyword: string, data: ApiResp): SearchResult[] {
  const out: SearchResult[] = []
  for (const item of data.items ?? []) {
    for (const tor of item.torrents ?? []) {
      const magnet = tor.magnet ?? ''
      const workTitle = buildWorkTitle(keyword, tor.name ?? '')
      if (!workTitle || !magnet) continue
      const datetime = (tor.published_at && parseIsoLike(tor.published_at)) || nowIso()
      const content = [
        `文件名: ${tor.name ?? ''}`,
        `大小: ${(tor.size_gb ?? 0).toFixed(2)} GB`,
        `做种: ${tor.seeders ?? 0}`,
        `下载: ${tor.leechers ?? 0}`,
        ...(tor.published_ago ? [`发布: ${tor.published_ago}`] : []),
      ].join(' | ')
      out.push(
        makeResult({
          plugin: 'feikuai',
          id: tor.info_hash ?? '',
          title: workTitle,
          content,
          datetime,
          links: [{ url: magnet, type: 'magnet', workTitle }],
          tags: extractTags(item.title ?? '', tor.name ?? ''),
        }),
      )
    }
  }
  return out
}

function webPassword(linkUrl: string, content: string): string {
  try {
    const pwd = new URL(linkUrl).searchParams.get('pwd')
    if (pwd) return pwd
  } catch {
    // 非法 URL 忽略
  }
  return WEB_PWD_RE.exec(content)?.[1] ?? ''
}

function webTime(text: string): string {
  const m = WEB_TIME_RE.exec(text)?.[0]
  if (!m) return ZERO_TIME
  return parseIsoLike(m.length === 10 ? `${m} 00:00:00` : m) || ZERO_TIME
}

function parseWeb(keyword: string, html: string): SearchResult[] {
  const root = parseHtml(html)
  const results: SearchResult[] = []
  const seen = new Set<string>()
  const add = (rawUrl: string, title: string, content: string) => {
    const url = rawUrl.trim()
    if (!url) return
    const type = getLinkType(url)
    if (!type || type === 'others' || seen.has(url)) return
    seen.add(url)
    const t = (title || keyword).trim()
    const datetime = webTime(content)
    results.push(
      makeResult({
        plugin: 'feikuai',
        id: stableHash(url), // 原版用 md5 前 8 字节，这里换同步哈希（仅用于去重 ID）
        title: t,
        content: content.trim(),
        datetime,
        links: [{ url, type, password: webPassword(url, content), datetime, workTitle: t }],
      }),
    )
  }
  for (const item of root.querySelectorAll('#panel-pan .module-row-info a.module-row-text[href]')) {
    if (results.length >= 50) break
    const title = (item.getAttribute('title') ?? '').trim() || textOf(item.querySelector('h4'))
    add(item.getAttribute('href') ?? '', title, textOf(item.querySelector('.ext-meta')))
  }
  for (const item of root.querySelectorAll('#panel-bm .bm-item a.module-row-text[href]')) {
    if (results.length >= 100) break
    const title = (item.getAttribute('title') ?? '').trim() || textOf(item.querySelector('.bm-file'))
    add(item.getAttribute('href') ?? '', title, textOf(item.querySelector('.ext-meta')))
  }
  return results
}

async function searchWeb(keyword: string, ctx: PluginContext, apiErr: string) {
  const url = `${SEARCH_WEB_URL}?${new URLSearchParams({ wd: keyword, ext: '1' })}`
  let html: string
  try {
    html = await ctx.http.text(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: 'https://feikuai.in/',
      },
    })
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e
    throw new Error(`[feikuai] API 失败且网页搜索失败: ${errMsg(e)} (API: ${apiErr})`)
  }
  const results = parseWeb(keyword, html)
  if (results.length === 0) throw new Error(`[feikuai] API 失败且网页搜索没有有效资源 (API: ${apiErr})`)
  return filterByKeyword(results, keyword)
}

export default definePlugin({
  name: 'feikuai',
  priority: 3,
  skipServiceFilter: true,
  async search(keyword, ctx) {
    const url = `${SEARCH_API_URL}?${new URLSearchParams({ kw: keyword })}`
    let data: ApiResp
    try {
      data = await ctx.http.json<ApiResp>(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: 'https://feikuai.tv/',
        },
        retries: 1, // 原版 3 次；与网页回退合计最坏 4 个子请求
      })
      if (data.code !== undefined && data.code !== 0) throw new Error(`API 返回错误: ${data.msg ?? ''} (code: ${data.code})`)
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e
      return searchWeb(keyword, ctx, errMsg(e))
    }
    return filterByKeyword(parseApi(keyword, data), keyword)
  },
})
