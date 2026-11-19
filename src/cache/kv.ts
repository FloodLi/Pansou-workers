import type { QueryEntry, ResultCache } from './types'

/** KV 最小过期时间为 60 秒。 */
const KV_MIN_TTL = 60

export class KvCache implements ResultCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<QueryEntry | null> {
    const v = await this.kv.get<QueryEntry>(key, 'json')
    return v && v.v === 1 ? v : null
  }

  async put(key: string, entry: QueryEntry, ttlSec: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(entry), { expirationTtl: Math.max(KV_MIN_TTL, Math.floor(ttlSec)) })
  }
}

/** 进程内缓存：未绑定 KV 时的降级实现，也用于测试。isolate 回收后即丢失。 */
export class MemoryCache implements ResultCache {
  private store = new Map<string, { entry: QueryEntry; expires: number }>()

  async get(key: string): Promise<QueryEntry | null> {
    const hit = this.store.get(key)
    if (!hit) return null
    if (hit.expires < Date.now()) {
      this.store.delete(key)
      return null
    }
    return hit.entry
  }

  async put(key: string, entry: QueryEntry, ttlSec: number): Promise<void> {
    if (this.store.size > 200) this.store.clear() // 粗暴限容，避免 isolate 内存增长
    this.store.set(key, { entry, expires: Date.now() + ttlSec * 1000 })
  }
}

/** 缓存键：只依赖关键词（来源在值里分条存放）。 */
export async function queryKey(keyword: string): Promise<string> {
  const data = new TextEncoder().encode(keyword.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-1', data)
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `v1:q:${hex}`
}
