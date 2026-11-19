import type { SearchResult } from '../types'
import { fulfilled, mapLimit } from '../core/pool'
import { unescapeHtml } from '../core/html'
import { parseTime } from '../core/time'
import { getLinkType } from '../links'
import { definePlugin, makeResult } from './types'

const NAME = 'melost'
const SEARCH_API = 'https://www.melost.cn/v1/search/disk'
const ORIGIN = 'https://www.melost.cn'
const REFERER = 'https://www.melost.cn/search'
const PAGE_SIZE = 30
const MAX_PAGES = 3
const AUTOMATED = '0'

interface Item {
  disk_id?: string
  disk_name?: string
  disk_pass?: string
  disk_type?: string
  files?: string
  share_user?: string
  shared_time?: string
  tags?: unknown
  link?: string
}

interface Resp {
  code?: number
  msg?: string
  data?: { list?: Item[] | null }
}

const DISK_TYPES: Record<string, string> = {
  BDY: 'baidu',
  BAIDU: 'baidu',
  ALY: 'aliyun',
  ALIYUN: 'aliyun',
  QUARK: 'quark',
  TIANYI: 'tianyi',
  UC: 'uc',
  CAIYUN: 'mobile',
  MOBILE: 'mobile',
  '115': '115',
  XUNLEI: 'xunlei',
  '123': '123',
  '123PAN': '123',
  PIKPAK: 'pikpak',
  LANZOU: 'lanzou',
}

function convertDiskType(diskType: string, url: string): string {
  return DISK_TYPES[diskType.trim().toUpperCase()] ?? getLinkType(url.trim())
}

function cleanHtml(v: string | undefined): string {
  if (!v) return ''
  return unescapeHtml(v).replace(/<[^>]+>/g, '').replace(/\r\n/g, '\n').trim()
}

function processTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
}

function scoreItem(it: Item): number {
  let s = (it.files ?? '').length
  if ((it.disk_pass ?? '').trim()) s += 5
  if ((it.shared_time ?? '').trim()) s += 3
  if ((it.share_user ?? '').trim()) s += 2
  if (it.tags != null) s += 2
  return s
}

/** 去重键：disk_id，其次 link，再次 名称|类型；重复时保留信息更全者。 */
function dedupe(items: Item[]): Item[] {
  const map = new Map<string, Item>()
  for (const it of items) {
    const key = it.disk_id || it.link || `${it.disk_name ?? ''}|${it.disk_type ?? ''}`
    const old = map.get(key)
    if (!old || scoreItem(it) > scoreItem(old)) map.set(key, it)
  }
  return [...map.values()]
}

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
    const pages = Array.from({ length: MAX_PAGES }, (_, i) => i + 1)
    // 请求体字段按 Go 原样（含 search_ticket/fp_data/automated），不自行构造握手；Go 版无重试
    const settled = await mapLimit(pages, MAX_PAGES, async (page) => {
      const resp = await ctx.http.json<Resp>(SEARCH_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Origin: ORIGIN,
          Referer: REFERER,
        },
        body: JSON.stringify({
          page,
          q: keyword,
          user: '',
          exact: false,
          user_distinct: false,
          format: [],
          share_time: '',
          share_year: '',
          size: PAGE_SIZE,
          order: '',
          type: '',
          search_ticket: '',
          exclude_user: [],
          adv_params: { wechat_pwd: '', search_code: '', platform: 'pc', fp_data: '', automated: AUTOMATED },
        }),
        timeoutMs: 30000,
        retries: 0,
      })
      if (resp.code !== 200) throw new Error(`[${NAME}] api returned error: ${resp.msg ?? ''}`)
      return resp.data?.list ?? []
    })

    const all = fulfilled(settled).flat()
    if (all.length === 0) {
      const failed = settled.find((s) => s.status === 'rejected')
      if (failed && failed.status === 'rejected') throw failed.reason
    }

    const out: SearchResult[] = []
    dedupe(all).forEach((it, i) => {
      const link = (it.link ?? '').trim()
      if (!link) return
      const tags = processTags(it.tags)
      const files = cleanHtml(it.files)
      const shareUser = (it.share_user ?? '').trim()
      const parts: string[] = []
      if (files) parts.push(files)
      if (shareUser) parts.push(`分享用户: ${shareUser}`)
      if (tags.length) parts.push(`标签: ${tags.join('、')}`)

      const r = makeResult({
        plugin: NAME,
        id: it.disk_id || `${Date.now()}-${i}`,
        title: cleanHtml(it.disk_name),
        content: parts.join('\n'),
        datetime: parseTime(it.shared_time),
        links: [{ url: link, type: convertDiskType(it.disk_type ?? '', link), password: (it.disk_pass ?? '').trim() }],
        tags,
      })
      if (matchesKeyword(r.title, r.content, keyword)) out.push(r)
    })
    return out
  },
})
