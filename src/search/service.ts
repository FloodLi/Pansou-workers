import type { QueryEntry, ResultCache, SourceEntry } from '../cache/types'
import { queryKey } from '../cache/kv'
import type { AppConfig } from '../config'
import { SubrequestBudget } from '../core/budget'
import { HttpClient, errMsg, sleep } from '../core/http'
import { MAX_CONNECTIONS, mapLimit } from '../core/pool'
import { runPlugin } from '../plugins/run'
import { selectPlugins } from '../plugins/registry'
import type { Plugin } from '../plugins/types'
import { searchChannel } from '../tg/search'
import type { SearchResponse, SearchResult } from '../types'
import { mergeSearchResults } from './merge'
import { mergeResultsByType } from './mergeByType'
import { getKeywordPriority, getResultSource, sortResults } from './rank'

export interface SearchParams {
  keyword: string
  channels: string[]
  forceRefresh: boolean
  resultType: string
  sourceType: string
  plugins: string[]
  cloudTypes?: string[]
  ext: Record<string, unknown>
}

export interface SearchDeps {
  config: AppConfig
  plugins: Plugin[]
  cache: ResultCache
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  now?: () => number
}

export interface SearchOutcome {
  response: SearchResponse
  /** 仍在后台继续的工作（慢来源 + 缓存写入）；调用方应交给 ctx.waitUntil */
  background: Promise<void>
  /** 调试信息：子请求用量、各来源状态 */
  stats: { subrequests: number; fetched: string[]; cached: string[]; pending: string[]; failed: Record<string, string> }
}

interface SourceTask {
  key: string
  run: () => Promise<SearchResult[]>
}

/**
 * 搜索主流程。
 * 1. 一次读取该关键词的缓存条目；新鲜的来源直接复用，不发起外部请求。
 * 2. 其余来源并发抓取；等到"全部完成或超出响应窗口"就返回已有结果（含过期缓存兜底）。
 * 3. 没跑完的来源在 background 里继续，完成后把整条缓存回写一次。
 */
export async function search(p: SearchParams, deps: SearchDeps): Promise<SearchOutcome> {
  const { config } = deps
  const now = deps.now ?? Date.now
  const budget = new SubrequestBudget(config.subrequestBudget)
  const http = new HttpClient(budget, deps.fetchImpl)

  const sourceType = p.sourceType || 'all'
  const wantTG = sourceType === 'all' || sourceType === 'tg'
  const wantPlugin = sourceType === 'all' || sourceType === 'plugin'

  const pluginList = wantPlugin ? selectPlugins(deps.plugins, config.enabledPlugins, p.plugins) : []
  const channels = wantTG ? p.channels.slice(0, config.maxTgChannels) : []

  const tasks: SourceTask[] = []
  for (const ch of channels) {
    tasks.push({ key: `tg:${ch}`, run: () => searchChannel(p.keyword, ch, http.withTag(`tg:${ch}`), config) })
  }
  for (const plugin of pluginList) {
    tasks.push({
      key: `plugin:${plugin.name}`,
      run: async () => {
        const out = await runPlugin(plugin, p.keyword, { http, config, budget, ext: p.ext })
        if (!out.ok) throw new Error(out.error)
        return out.results
      },
    })
  }

  // ---- 缓存读取（占 1 次预算；失败不影响搜索）
  const key = await queryKey(p.keyword)
  let cached: QueryEntry | null = null
  if (!p.forceRefresh && tasks.length > 0) {
    try {
      // KV 读写算"Cloudflare 服务子请求"（免费版上限 1000，单独计数），不占 50 次外部子请求预算
      cached = await deps.cache.get(key)
    } catch {
      cached = null
    }
  }
  const entry: QueryEntry = { v: 1, sources: { ...(cached?.sources ?? {}) } }

  const isFresh = (e: SourceEntry | undefined): boolean => {
    if (!e) return false
    const ttl = e.final ? config.cacheTtlSec : config.partialCacheTtlSec
    return now() - e.ts < ttl * 1000
  }
  const stats: SearchOutcome['stats'] = { subrequests: 0, fetched: [], cached: [], pending: [], failed: {} }
  const toRun = tasks.filter((t) => {
    const e = entry.sources[t.key]
    if (!p.forceRefresh && isFresh(e)) {
      stats.cached.push(t.key)
      return false
    }
    return true
  })

  // ---- 并发抓取，结果逐个落入 done
  const done = new Map<string, SourceEntry>()
  const finishedAll = mapLimit(toRun, MAX_CONNECTIONS, async (t) => {
    try {
      const results = await t.run()
      done.set(t.key, { results, final: true, ts: now() })
    } catch (e) {
      // 失败不覆盖已有结果，只记录短 TTL 标记
      const prev = entry.sources[t.key]
      done.set(t.key, { results: prev?.results ?? [], final: false, ts: now(), error: errMsg(e) })
    }
  })

  if (toRun.length > 0) {
    await Promise.race([finishedAll, sleep(config.asyncResponseMs)])
  }

  // ---- 组装响应：新结果 > 缓存（含过期兜底）
  const collected: SearchResult[] = []
  const sourceKeys = tasks.map((t) => t.key)
  for (const k of sourceKeys) {
    const fresh = done.get(k)
    const e = fresh ?? entry.sources[k]
    if (fresh) {
      stats.fetched.push(k)
      if (fresh.error) stats.failed[k] = fresh.error
    } else if (toRun.some((t) => t.key === k)) {
      stats.pending.push(k)
    }
    if (e) collected.push(...e.results)
  }

  const levelByName = new Map(deps.plugins.map((pl) => [pl.name, pl.priority]))
  const levelOf = (source: string): number => {
    const [kind, name] = source.split(':')
    return kind === 'plugin' && name ? (levelByName.get(name) ?? 3) : 3
  }
  const skipFilterByName = new Map(deps.plugins.map((pl) => [pl.name, pl.skipServiceFilter]))

  const merged = mergeSearchResults([], collected)
  sortResults(merged, levelOf, now())

  const filteredForResults = merged.filter(
    (r) => !r.datetime.startsWith('0001-01-01') || getKeywordPriority(r.title) > 0 || levelOf(getResultSource(r)) <= 2,
  )
  const mergedLinks = mergeResultsByType(merged, p.keyword, p.cloudTypes, (n) => skipFilterByName.get(n) ?? false)

  let total: number
  if (p.resultType === 'merged_by_type') {
    total = Object.values(mergedLinks).reduce((n, l) => n + l.length, 0)
  } else {
    total = filteredForResults.length
  }
  const response = omitEmpty(
    filterResponseByType({ total, results: filteredForResults, merged_by_type: mergedLinks }, p.resultType),
  )

  // ---- 后台：等剩余来源跑完，再整体回写缓存（仅一次写）
  const background = (async () => {
    if (toRun.length === 0) return
    await finishedAll
    for (const [k, v] of done) entry.sources[k] = v
    const ttl = Object.values(entry.sources).some((s) => s.final) ? config.cacheTtlSec : config.partialCacheTtlSec
    try {
      await deps.cache.put(key, entry, ttl)
    } catch {
      // 写缓存失败（含 KV 写限流）不影响结果
    }
    stats.subrequests = budget.usedCount
  })()
  stats.subrequests = budget.usedCount

  return { response, background, stats }
}

/** 对应原项目 filterResponseByType：决定响应里带哪些字段。 */
export function filterResponseByType(resp: SearchResponse, resultType: string): SearchResponse {
  switch (resultType) {
    case 'all':
      return resp
    case 'results':
      return { total: resp.total, results: resp.results }
    default:
      // merged_by_type 以及其他未知取值
      return { total: resp.total, merged_by_type: resp.merged_by_type }
  }
}

/** 对应 Go 的 `json:",omitempty"`：空数组/空对象不输出（客户端据此判断是否有结果）。 */
export function omitEmpty(resp: SearchResponse): SearchResponse {
  const out: SearchResponse = { total: resp.total }
  if (resp.results && resp.results.length > 0) out.results = resp.results
  if (resp.merged_by_type && Object.keys(resp.merged_by_type).length > 0) out.merged_by_type = resp.merged_by_type
  return out
}
