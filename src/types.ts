// 与原项目 model/*.go 对齐的数据结构。字段名保持 snake_case，保证前端/客户端兼容。

/** Go 的 time.Time 零值序列化结果；原项目对缺失时间输出该值。 */
export const ZERO_TIME = '0001-01-01T00:00:00Z'

export interface Link {
  type: string
  url: string
  password: string
  datetime: string
  work_title?: string
}

export interface SearchResult {
  message_id: string
  unique_id: string
  /** TG 结果为频道名；插件结果必须为空字符串 */
  channel: string
  datetime: string
  title: string
  content: string
  links: Link[]
  tags?: string[]
  images?: string[]
}

export interface MergedLink {
  url: string
  password: string
  note: string
  datetime: string
  /** `tg:<频道>` 或 `plugin:<插件名>` */
  source?: string
  images?: string[]
}

export type MergedLinks = Record<string, MergedLink[]>

export interface SearchResponse {
  total: number
  results?: SearchResult[]
  merged_by_type?: MergedLinks
}

export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data?: T
}

export interface FilterConfig {
  /** 包含关键词列表（OR 关系） */
  include?: string[]
  /** 排除关键词列表（AND 关系，即命中任意一个就排除） */
  exclude?: string[]
}

export type ResultType = 'all' | 'results' | 'merged_by_type'
export type SourceType = 'all' | 'tg' | 'plugin'

export interface SearchRequest {
  kw: string
  channels?: string[]
  conc?: number
  refresh?: boolean
  res?: string
  src?: string
  plugins?: string[]
  ext?: Record<string, unknown>
  cloud_types?: string[]
  filter?: FilterConfig
}

/** Worker 绑定与环境变量 */
export interface Env {
  CACHE?: KVNamespace
  CHANNELS?: string
  ENABLED_PLUGINS?: string
  ASYNC_RESPONSE_TIMEOUT?: string
  PLUGIN_TIMEOUT?: string
  SUBREQUEST_BUDGET?: string
  CACHE_TTL?: string
  CACHE_PARTIAL_TTL_MINUTES?: string
  MAX_TG_CHANNELS?: string
  MAX_PAGES_YUNSOU?: string
  MAX_PAGES_CLDI?: string
  /** 静态访问令牌（用 secret 设置）。设置后除 /api/health 外的接口都需要 `Authorization: Bearer <令牌>` */
  API_TOKEN?: string
  /** 设为 "true" 时开启 /api/_debug/plugin/:name（生产默认关闭） */
  DEBUG_ROUTES?: string
}

export function success<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data }
}

export function failure(code: number, message: string): ApiResponse {
  return { code, message }
}
