import type { HttpClient } from '../../core/http'
import { getLinkType } from '../../links'
import { makeResult, type LinkInput } from '../types'
import type { SearchResult } from '../../types'

// wanou 与 ouge 共用的 MacCMS 采集接口解析：vod_down_from / vod_down_url 以 $$$ 分隔按下标配对。

export const MACCMS_HOST = 'https://woog.nxog.eu.org'

export interface MacCmsItem {
  vod_id?: number | string
  vod_name?: string
  vod_actor?: string
  vod_director?: string
  vod_down_from?: string
  vod_down_url?: string
  vod_remarks?: string
  vod_area?: string
  vod_year?: string
  vod_pic?: string
}

export interface MacCmsResponse {
  code?: number
  msg?: string
  list?: MacCmsItem[] | null
}

// Go 版各网盘 URL 正则，用于校验链接是否属于支持的网盘
const RE = {
  quark: /https?:\/\/pan\.quark\.cn\/s\/[0-9a-zA-Z]+/,
  uc: /https?:\/\/drive\.uc\.cn\/s\/[0-9a-zA-Z]+(\?[^"'\s]*)?/,
  baidu: /https?:\/\/pan\.baidu\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/,
  aliyun: /https?:\/\/(www\.)?(aliyundrive\.com|alipan\.com)\/s\/[0-9a-zA-Z]+/,
  xunlei: /https?:\/\/pan\.xunlei\.com\/s\/[0-9a-zA-Z_-]+(\?pwd=[0-9a-zA-Z]+)?/,
  tianyi: /https?:\/\/cloud\.189\.cn\/t\/[0-9a-zA-Z]+/,
  '115': /https?:\/\/115\.com\/s\/[0-9a-zA-Z]+/,
  mobile: /https?:\/\/caiyun\.feixin\.10086\.cn\/[0-9a-zA-Z]+/,
  '123': /https?:\/\/123pan\.com\/s\/[0-9a-zA-Z]+/,
  pikpak: /https?:\/\/mypikpak\.com\/s\/[0-9a-zA-Z]+/,
  magnet: /magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/,
  ed2k: /ed2k:\/\/\|file\|.+\|\d+\|[0-9a-fA-F]{32}\|\//,
} as const

type PanType = keyof typeof RE

/** 接口标识 -> 网盘类型。wanou 用 PIKPAK、ouge 用 PK，故由调用方给出差异。 */
const COMMON_CODES: Record<string, PanType> = {
  BD: 'baidu',
  KG: 'quark',
  UC: 'uc',
  ALY: 'aliyun',
  XL: 'xunlei',
  TY: 'tianyi',
  '115': '115',
  MB: 'mobile',
  '123': '123',
}

export type MacCmsVariant = 'wanou' | 'ouge'

const CODES: Record<MacCmsVariant, Record<string, PanType>> = {
  wanou: { ...COMMON_CODES, PIKPAK: 'pikpak' },
  ouge: { ...COMMON_CODES, PK: 'pikpak' },
}

function matchesAny(url: string): boolean {
  return Object.values(RE).some((r) => r.test(url))
}

/** 基本校验：排除脚本/锚点链接及非 http/magnet/ed2k 前缀。 */
function basicValid(url: string): boolean {
  if (!url || url.includes('javascript:') || url.includes('#')) return false
  return url.startsWith('http') || url.startsWith('magnet:') || url.startsWith('ed2k:')
}

/** 按 Go 版各插件的差异判定类型；返回 '' 表示丢弃。 */
function resolveType(variant: MacCmsVariant, apiCode: string, url: string): string {
  if (!basicValid(url)) return ''
  const mapped = CODES[variant][apiCode.toUpperCase()]
  if (variant === 'wanou') {
    // wanou：接口标识命中后仍需 URL 正则校验，否则回退到 URL 识别
    if (mapped && RE[mapped].test(url)) return mapped
    return matchesAny(url) ? getLinkType(url) : ''
  }
  // ouge：先要求 URL 属于支持的网盘，再优先信任接口标识
  if (!matchesAny(url)) return ''
  return mapped ?? getLinkType(url)
}

const PWD_RE = /\?pwd=([0-9a-zA-Z]+)/

export function parseMacCmsLinks(variant: MacCmsVariant, downFrom: string, downUrl: string): LinkInput[] {
  if (!downFrom || !downUrl) return []
  const froms = downFrom.split('$$$')
  const urls = downUrl.split('$$$')
  const n = Math.min(froms.length, urls.length)
  const links: LinkInput[] = []
  for (let i = 0; i < n; i++) {
    const url = (urls[i] ?? '').trim()
    if (!url) continue
    const type = resolveType(variant, (froms[i] ?? '').trim(), url)
    if (!type) continue
    links.push({ url, type, password: PWD_RE.exec(url)?.[1] ?? '' })
  }
  return links
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function parseMacCmsItem(plugin: MacCmsVariant, item: MacCmsItem): SearchResult | null {
  const title = str(item.vod_name).trim()
  if (!title) return null
  const links = parseMacCmsLinks(plugin, str(item.vod_down_from), str(item.vod_down_url))
  if (links.length === 0) return null

  const parts: string[] = []
  const add = (label: string, v: string) => v && parts.push(`${label}: ${v}`)
  add('主演', str(item.vod_actor))
  add('导演', str(item.vod_director))
  add('地区', str(item.vod_area))
  add('年份', str(item.vod_year))
  add('状态', str(item.vod_remarks))

  const tags = [str(item.vod_year), str(item.vod_area)].filter(Boolean)
  const pic = str(item.vod_pic)
  return makeResult({
    plugin,
    id: str(item.vod_id),
    title,
    content: parts.join(' | '),
    links,
    tags,
    images: pic ? [pic] : [],
  })
}

/** GET ?ac=detail&wd=<kw>；code!==1 视为失败。 */
export async function searchMacCms(http: HttpClient, plugin: MacCmsVariant, keyword: string): Promise<SearchResult[]> {
  const url = `${MACCMS_HOST}/api.php/provide/vod?ac=detail&wd=${encodeURIComponent(keyword)}`
  // 去掉了随机 UA；Go 版最多 2 次尝试，对应 retries=1
  const resp = await http.json<MacCmsResponse>(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: `${MACCMS_HOST}/`,
      'Cache-Control': 'no-cache',
    },
    retries: 1,
  })
  if (resp.code !== 1) throw new Error(`[${plugin}] API返回错误: ${resp.msg ?? ''}`)
  const out: SearchResult[] = []
  for (const item of resp.list ?? []) {
    const r = parseMacCmsItem(plugin, item)
    if (r) out.push(r)
  }
  return out
}
