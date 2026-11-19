import type { SearchResult } from '../types'

// 移植自 service/search_service.go 的排序逻辑。

const PRIORITY_KEYWORDS = ['合集', '系列', '全', '完', '最新', '附', 'complete']

/** 结果来源：`tg:<频道>` / `plugin:<插件名>` / `unknown`。 */
export function getResultSource(r: SearchResult): string {
  if (r.channel !== '') return `tg:${r.channel}`
  if (r.unique_id !== '' && r.unique_id.includes('-')) return `plugin:${r.unique_id.split('-', 1)[0]}`
  return 'unknown'
}

export function getKeywordPriority(title: string): number {
  const t = title.toLowerCase()
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (t.includes(PRIORITY_KEYWORDS[i] as string)) return (PRIORITY_KEYWORDS.length - i) * 70
  }
  return 0
}

export function calculateTimeScore(datetime: string, now: number): number {
  const t = Date.parse(datetime)
  // 无时间信息（含 Go 零值）得 0 分
  if (Number.isNaN(t) || datetime.startsWith('0001-01-01')) return 0
  const days = (now - t) / 86_400_000
  if (days <= 1) return 500
  if (days <= 3) return 400
  if (days <= 7) return 300
  if (days <= 30) return 200
  if (days <= 90) return 100
  if (days <= 365) return 50
  return 20
}

/** source → 插件等级(1~4)。TG 与未知来源按 3。 */
export type LevelOf = (source: string) => number

export function levelScore(level: number): number {
  switch (level) {
    case 1:
      return 1000
    case 2:
      return 500
    case 4:
      return -200
    default:
      return 0
  }
}

/** 按 时间分 + 关键词优先级 + 插件等级 综合降序排序（就地）。 */
export function sortResults(results: SearchResult[], levelOf: LevelOf, now = Date.now()): void {
  const scored = results.map((r) => ({
    r,
    score: calculateTimeScore(r.datetime, now) + getKeywordPriority(r.title) + levelScore(levelOf(getResultSource(r))),
  }))
  scored.sort((a, b) => b.score - a.score)
  scored.forEach((s, i) => {
    results[i] = s.r
  })
}
