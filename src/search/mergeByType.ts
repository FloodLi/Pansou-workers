import type { MergedLink, MergedLinks, SearchResult } from '../types'
import { cutTitleByKeywords, extractLinkTitlePairs, titlesFromPrefixSplit } from './titles'

function ts(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/**
 * 按网盘类型分组并按 URL 去重（移植自 mergeResultsByType）。
 * @param skipFilterFor 插件名 → 是否跳过关键词过滤（对应 SkipServiceFilter）
 */
export function mergeResultsByType(
  results: SearchResult[],
  keyword: string,
  cloudTypes: string[] | undefined,
  skipFilterFor: (pluginName: string) => boolean,
): MergedLinks {
  const lowerKeyword = keyword.toLowerCase()
  const unique = new Map<string, MergedLink>()

  for (const result of results) {
    let linkTitleMap = extractLinkTitlePairs(result.content)
    if (linkTitleMap.size === 0 && result.links.length > 0 && !result.content.includes('\n')) {
      linkTitleMap = titlesFromPrefixSplit(
        result.content,
        result.links.map((l) => l.url),
      )
    }

    // 来源与是否跳过过滤，仅与结果相关，循环外算一次
    const dash = result.unique_id.indexOf('-')
    const pluginName = dash >= 0 ? result.unique_id.slice(0, dash) : ''
    const skipKeywordFilter = pluginName !== '' && skipFilterFor(pluginName)
    let source: string
    if (result.channel !== '') source = `tg:${result.channel}`
    else if (pluginName !== '') source = `plugin:${pluginName}`
    else source = 'unknown'

    for (const link of result.links) {
      let title = result.title
      if (link.work_title) {
        title = link.work_title
      } else {
        const specific = linkTitleMap.get(link.url)
        if (specific) {
          title = specific
        } else {
          for (const [mapped, mappedTitle] of linkTitleMap) {
            if (mapped.startsWith(link.url)) {
              title = mappedTitle
              break
            }
          }
        }
      }

      // 关键词过滤：插件结果依赖链接标题；TG 结果已经过 t.me/s 服务端搜索，正文命中也算
      if (!skipKeywordFilter && keyword !== '') {
        const titleMatched = title.toLowerCase().includes(lowerKeyword)
        const contentMatched = result.channel !== '' && result.content.toLowerCase().includes(lowerKeyword)
        if (!titleMatched && !contentMatched) continue
      }

      const note = cutTitleByKeywords(title, ['简介', '描述'])
      const datetime = link.datetime && !link.datetime.startsWith('0001-01-01') ? link.datetime : result.datetime
      const merged: MergedLink = { url: link.url, password: link.password, note, datetime, source }
      if (result.images?.length) merged.images = result.images

      const existing = unique.get(link.url)
      if (!existing || ts(merged.datetime) > ts(existing.datetime)) unique.set(link.url, merged)
    }
  }

  // 按原始 results 顺序收集唯一链接，再按类型分组
  const grouped: MergedLinks = {}
  const added = new Set<string>()
  for (const result of results) {
    for (const link of result.links) {
      const m = unique.get(link.url)
      if (!m || added.has(link.url)) continue
      added.add(link.url)
      const type = link.type || 'unknown'
      ;(grouped[type] ??= []).push(m)
    }
  }

  if (cloudTypes && cloudTypes.length > 0) {
    const allowed = new Set(cloudTypes.map((t) => t.trim().toLowerCase()))
    const filtered: MergedLinks = {}
    for (const [type, links] of Object.entries(grouped)) {
      if (allowed.has(type.toLowerCase())) filtered[type] = links
    }
    return filtered
  }
  return grouped
}
