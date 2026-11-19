import type { SearchResult } from '../types'

/** 单个来源（`tg:<频道>` 或 `plugin:<名>`）的缓存条目。 */
export interface SourceEntry {
  results: SearchResult[]
  /** true 表示完整结果，按 CACHE_TTL 判定新鲜度；false 表示失败/部分，按更短的 TTL 判定 */
  final: boolean
  /** 写入时间（epoch 毫秒） */
  ts: number
  /** 失败信息（仅调试用） */
  error?: string
}

/** 一次查询的缓存：把各来源合并存成一个 KV 值，一次读、一次写，节省免费版的 KV 写配额。 */
export interface QueryEntry {
  v: 1
  sources: Record<string, SourceEntry>
}

export interface ResultCache {
  get(key: string): Promise<QueryEntry | null>
  put(key: string, entry: QueryEntry, ttlSec: number): Promise<void>
}
