import type { FilterConfig, MergedLinks, SearchResponse, SearchResult } from '../types'

// 移植自 api/filter.go

function matchFilter(text: string, include: string[], exclude: string[]): boolean {
  const lower = text.toLowerCase()
  if (exclude.some((kw) => lower.includes(kw))) return false
  if (include.length > 0 && !include.some((kw) => lower.includes(kw))) return false
  return true
}

function filterMerged(merged: MergedLinks | undefined, include: string[], exclude: string[]): MergedLinks | undefined {
  if (!merged) return merged
  const out: MergedLinks = {}
  for (const [type, links] of Object.entries(merged)) {
    const kept = links.filter((l) => matchFilter(l.note, include, exclude))
    if (kept.length > 0) out[type] = kept
  }
  return out
}

function filterResults(results: SearchResult[] | undefined, include: string[], exclude: string[]): SearchResult[] | undefined {
  if (!results) return results
  const out: SearchResult[] = []
  for (const r of results) {
    if (!matchFilter(r.title, include, exclude)) continue
    const links = r.links.filter((l) => matchFilter(l.work_title || r.title, include, exclude))
    if (links.length > 0) out.push({ ...r, links })
  }
  return out
}

export function applyResultFilter(resp: SearchResponse, filter: FilterConfig | undefined, resultType: string): SearchResponse {
  if (!filter || ((filter.include?.length ?? 0) === 0 && (filter.exclude?.length ?? 0) === 0)) return resp
  const include = (filter.include ?? []).map((s) => s.toLowerCase())
  const exclude = (filter.exclude ?? []).map((s) => s.toLowerCase())
  const out: SearchResponse = { ...resp }

  if (resultType === 'merged_by_type' || resultType === '') {
    const merged = filterMerged(out.merged_by_type, include, exclude)
    if (merged) out.merged_by_type = merged
    out.total = Object.values(merged ?? {}).reduce((n, l) => n + l.length, 0)
  } else if (resultType === 'all' || resultType === 'results') {
    const results = filterResults(out.results, include, exclude)
    if (results) out.results = results
    out.total = results?.length ?? 0
    if (resultType === 'all') {
      const merged = filterMerged(out.merged_by_type, include, exclude)
      if (merged) out.merged_by_type = merged
    }
  }
  return out
}
