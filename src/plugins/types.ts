import type { AppConfig } from '../config'
import type { HttpClient } from '../core/http'
import { getLinkType } from '../links'
import { ZERO_TIME, type Link, type SearchResult } from '../types'

export interface PluginContext {
  /** 已绑定插件名前缀、共用请求级预算的 HTTP 客户端。插件只能通过它出站。 */
  http: HttpClient
  /** 请求里的 ext 扩展参数 */
  ext: Record<string, unknown>
  /** 超时/取消信号 */
  signal: AbortSignal
  config: AppConfig
}

export interface Plugin {
  /** 小写，唯一；同时是 unique_id 前缀 */
  name: string
  /** 1(最高) ~ 4，决定排序加权：1:+1000 2:+500 3:0 4:-200 */
  priority: 1 | 2 | 3 | 4
  /** 对应原项目 NewBaseAsyncPluginWithFilter(..., true) */
  skipServiceFilter: boolean
  search(keyword: string, ctx: PluginContext): Promise<SearchResult[]>
}

export function definePlugin(p: Plugin): Plugin {
  return p
}

export interface LinkInput {
  url: string
  /** 缺省时按 URL 自动识别 */
  type?: string
  password?: string
  datetime?: string
  workTitle?: string
}

export function makeLink(l: LinkInput): Link {
  const link: Link = {
    type: l.type ?? getLinkType(l.url),
    url: l.url,
    password: l.password ?? '',
    datetime: l.datetime ?? ZERO_TIME,
  }
  if (l.workTitle) link.work_title = l.workTitle
  return link
}

export interface ResultInput {
  plugin: string
  /** 站内唯一 id，最终 unique_id = `<plugin>-<id>` */
  id: string
  title: string
  content?: string
  datetime?: string
  links: LinkInput[]
  tags?: string[]
  images?: string[]
}

/** 构造插件结果：channel 固定为空串（原项目约定），unique_id 带插件名前缀。 */
export function makeResult(r: ResultInput): SearchResult {
  const datetime = r.datetime ?? ZERO_TIME
  const out: SearchResult = {
    message_id: '',
    unique_id: `${r.plugin}-${r.id}`,
    channel: '',
    datetime,
    title: r.title,
    content: r.content ?? '',
    links: r.links.map((l) => makeLink({ datetime, ...l })),
  }
  if (r.tags?.length) out.tags = r.tags
  if (r.images?.length) out.images = r.images
  return out
}
