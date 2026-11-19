import { SerovalDecoder, type SerovalNode } from './_helpers/seroval'
import { definePlugin, makeResult } from './types'
import type { PluginContext } from './types'
import type { SearchResult } from '../types'

const NAME = 'xiaokupan'
const BASE_URL = 'https://xiaokupan.com'
const DEFAULT_SERVER_FUNCTION_ID = 'ffb7ba806a267ced7478dc27716e79ea729a98a801af2ac9c3647bdaca91af78'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const MAX_SEARCH_BYTES = 4 << 20
const MAX_DISCOVERY_BYTES = 8 << 20

const INDEX_ASSET_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/
const HASH_RE = /[a-f0-9]{64}/g

// 仅是 isolate 内的尽力缓存：Workers 无常驻内存，isolate 回收后回到硬编码默认值；
// 失效时由 refresh 路径重新发现（最坏 4 个子请求：搜索、首页、入口脚本、重试搜索）。
let serverFunctionId = DEFAULT_SERVER_FUNCTION_ID

/** 仅供测试：恢复默认函数 ID。 */
export function resetServerFunctionId(): void {
  serverFunctionId = DEFAULT_SERVER_FUNCTION_ID
}

export function cleanText(value: string): string {
  let v = value.trim().replace(/\s+/g, ' ')
  for (const suffix of ['投稿链接:', '投稿链接：', '链接:', '链接：']) {
    if (v.endsWith(suffix)) v = v.slice(0, -suffix.length)
    v = v.trim()
  }
  return v
}

function buildSearchPayload(keyword: string): string {
  // 键序与 Go json.Marshal(map) 一致（按字典序）
  return JSON.stringify({
    f: 63,
    m: [],
    t: {
      i: 0,
      o: 0,
      p: {
        k: ['data'],
        v: [{ i: 1, o: 0, p: { k: ['query'], v: [{ s: keyword, t: 1 }] }, t: 10 }],
      },
      t: 10,
    },
  })
}

async function searchWithFunctionId(ctx: PluginContext, keyword: string, functionId: string): Promise<SearchResult[]> {
  const qs = new URLSearchParams({ payload: buildSearchPayload(keyword) })
  const url = `${BASE_URL}/_serverFn/${functionId}?${qs.toString()}`
  // Go 版的随机 UA 等已去除；retries 置 0，重试由函数 ID 刷新路径统一承担以控制子请求数
  const body = await ctx.http.text(url, {
    retries: 0,
    maxBytes: MAX_SEARCH_BYTES,
    headers: {
      'User-Agent': UA,
      Accept: 'application/x-tss-framed, application/x-ndjson, application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/s/${encodeURIComponent(keyword)}`,
      'Sec-Fetch-Site': 'same-origin',
      'x-tsr-serverFn': 'true',
    },
  })
  return parseSearchResponse(body)
}

async function discoverServerFunctionId(ctx: PluginContext): Promise<string> {
  const homeUrl = `${BASE_URL}/`
  const home = await ctx.http.text(homeUrl, {
    retries: 0,
    maxBytes: MAX_DISCOVERY_BYTES,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  })
  const assetPath = home.match(INDEX_ASSET_RE)?.[0]
  if (!assetPath) throw new Error('首页未找到入口脚本')
  const asset = await ctx.http.text(BASE_URL + assetPath, {
    retries: 0,
    maxBytes: MAX_DISCOVERY_BYTES,
    headers: { 'User-Agent': UA, Referer: homeUrl },
  })
  const routeIndex = asset.indexOf('/s/$query')
  if (routeIndex < 0) throw new Error('入口脚本未找到搜索路由')
  // 只在路由字符串前 2KB 窗口内找，取最后一个 64 位十六进制串
  const window = asset.slice(Math.max(0, routeIndex - 2048), routeIndex)
  const hashes = window.match(HASH_RE)
  if (!hashes || hashes.length === 0) throw new Error('入口脚本未找到搜索接口标识')
  return hashes[hashes.length - 1] as string
}

async function refreshServerFunctionId(ctx: PluginContext, staleId: string): Promise<string> {
  if (serverFunctionId && serverFunctionId !== staleId) return serverFunctionId
  serverFunctionId = await discoverServerFunctionId(ctx)
  return serverFunctionId
}

function validResourceUrl(raw: string, linkType: string): boolean {
  const lower = raw.toLowerCase()
  if (linkType === 'magnet') return lower.startsWith('magnet:?')
  if (linkType === 'ed2k') return lower.startsWith('ed2k://')
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host !== ''
  } catch {
    return false
  }
}

function parseRfc3339(value: string): string {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(v) && !Number.isNaN(Date.parse(v))) return v
  // Go 版解析失败时取当前时间
  return new Date().toISOString()
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function parseSearchResponse(body: string): Promise<SearchResult[]> {
  let root: SerovalNode
  try {
    root = JSON.parse(body) as SerovalNode
  } catch (e) {
    throw new Error(`解析 Seroval 响应失败: ${(e as Error).message}`)
  }
  const d = new SerovalDecoder(root)
  const resultNode = d.objectValue(root, 'result')
  const searchResultsNode = d.objectValue(resultNode, 'searchResults')
  const merged = d.resolve(d.objectValue(searchResultsNode, 'merged_by_type'))
  if (!merged || !merged.p) throw new Error('响应缺少 merged_by_type')

  const keys = merged.p.k ?? []
  const values = merged.p.v ?? []
  const results: SearchResult[] = []
  const seen = new Set<string>()
  for (let index = 0; index < keys.length; index++) {
    if (index >= values.length) break
    const linkType = keys[index] as string
    const arr = d.resolve(values[index])
    if (!arr || arr.t !== 9) continue
    for (const item of arr.a ?? []) {
      const url = d.stringValue(d.objectValue(item, 'url')).trim()
      if (!validResourceUrl(url, linkType) || seen.has(url)) continue
      const note = cleanText(d.stringValue(d.objectValue(item, 'note')))
      if (!note) continue
      const password = d.stringValue(d.objectValue(item, 'password')).trim()
      const source = cleanText(d.stringValue(d.objectValue(item, 'source')))
      const datetime = parseRfc3339(d.stringValue(d.objectValue(item, 'datetime')))
      const images = d.stringArray(d.objectValue(item, 'images'))
      const id = await sha256Hex(url)
      const tags = [linkType]
      if (source) tags.push(source)
      const r = makeResult({
        plugin: NAME,
        id,
        title: note,
        content: note,
        datetime,
        links: [{ type: linkType, url, password, datetime, workTitle: note }],
        tags,
        images,
      })
      r.message_id = r.unique_id
      results.push(r)
      seen.add(url)
    }
  }
  return results
}

// 等价 Go plugin.FilterResultsByKeyword：多关键词均需出现在标题或内容中
function filterByKeyword(results: SearchResult[], keyword: string): SearchResult[] {
  const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  if (!keyword) return results
  return results.filter((r) => {
    const t = r.title.toLowerCase()
    const c = r.content.toLowerCase()
    return kws.every((kw) => t.includes(kw) || c.includes(kw))
  })
}

export default definePlugin({
  name: NAME,
  priority: 2,
  skipServiceFilter: false,
  async search(rawKeyword, ctx) {
    const keyword = cleanText(rawKeyword)
    if (!keyword) return []

    const functionId = serverFunctionId
    let results: SearchResult[]
    try {
      results = await searchWithFunctionId(ctx, keyword, functionId)
    } catch (err) {
      // 任何失败（含解析失败）都尝试重新发现函数 ID 后重试一次，与 Go 版一致
      let refreshed: string
      try {
        refreshed = await refreshServerFunctionId(ctx, functionId)
      } catch (refreshErr) {
        throw new Error(`[${NAME}] 搜索失败: ${(err as Error).message}；刷新接口标识失败: ${(refreshErr as Error).message}`)
      }
      results = await searchWithFunctionId(ctx, keyword, refreshed)
    }
    return filterByKeyword(results, keyword)
  },
})
