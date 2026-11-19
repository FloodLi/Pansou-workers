import type { SearchResult } from '../types'

const encoder = new TextEncoder()

export function generateResultKey(r: SearchResult): string {
  if (r.unique_id !== '') return r.unique_id
  if (r.message_id !== '') return r.message_id
  return `title_${r.title}_${r.channel}`
}

/** 信息完整度打分。Go 里 len(title) 是字节数，这里同样按 UTF-8 字节计，保证打分一致。 */
export function completenessScore(r: SearchResult): number {
  let score = 0
  if (r.unique_id !== '') score += 10
  if (r.links.length > 0) score += 5 + r.links.length
  if (r.content !== '') score += 3
  score += Math.floor(encoder.encode(r.title).length / 10)
  if (r.channel !== '') score += 2
  score += r.tags?.length ?? 0
  return score
}

function ts(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/** 去重合并：同 key 取信息更完整者；结果按时间降序。 */
export function mergeSearchResults(existing: SearchResult[], incoming: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>()
  for (const r of existing) map.set(generateResultKey(r), r)
  for (const r of incoming) {
    const key = generateResultKey(r)
    const old = map.get(key)
    map.set(key, old && completenessScore(r) <= completenessScore(old) ? old : r)
  }
  return Array.from(map.values()).sort((a, b) => ts(b.datetime) - ts(a.datetime))
}
