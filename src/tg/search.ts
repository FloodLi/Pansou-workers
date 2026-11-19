import type { AppConfig } from '../config'
import type { HttpClient } from '../core/http'
import type { SearchResult } from '../types'
import { ParseStatus, parseSearchResultsWithStatus } from './parse'

/**
 * 每频道最多请求页数。Go 版 BuildSearchURL 虽支持 before 翻页参数，
 * 但 searchChannelWithContext 始终传空串、只抓首页；免费版预算紧，保持单页。
 */
export const TG_MAX_PAGES = 1

/** 对应 TGResponseMaxBytes（Go 默认 2MB，这里放宽到 3MB）。 */
const TG_MAX_BYTES = 3 * 1024 * 1024

const TG_BASE = 'https://t.me/s/'

/** 对应 util.BuildSearchURL：关键词为空时不带 ?q。 */
export function buildSearchURL(channel: string, keyword: string): string {
  let url = TG_BASE + encodeURIComponent(channel)
  if (keyword !== '') url += '?q=' + encodeQuery(keyword)
  return url
}

// Go 的 QueryEscape 与 encodeURIComponent 的差异：空格为 +，且 !'()* 也要转义
function encodeQuery(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** 搜索单个 TG 频道（GET https://t.me/s/<channel>?q=<kw>），对应 searchChannelWithContext。 */
export async function searchChannel(
  keyword: string,
  channel: string,
  http: HttpClient,
  config: AppConfig,
): Promise<SearchResult[]> {
  void config
  // Go 的频道请求没有重试，非 200 直接判失败（http.text 对非 2xx 抛错）；
  // 重试交给上层的整体策略，这里 retries=0 以节省子请求预算
  const html = await http.text(buildSearchURL(channel, keyword), {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    maxBytes: TG_MAX_BYTES,
    retries: 0,
  })
  const { results, status } = parseSearchResultsWithStatus(html, channel)
  // 页面含消息块却解析不出条目，多半是 t.me 改版；Go 只打日志，这里同样不抛错
  if (status === ParseStatus.StructureChanged) {
    console.warn(`[searchTG] 频道 ${channel} 的结果页含消息块但未解析出任何条目，页面结构可能已变`)
  }
  return results
}
