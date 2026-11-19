import type { Env } from './types'

export interface AppConfig {
  defaultChannels: string[]
  enabledPlugins: string[]
  /** 尽快响应窗口（毫秒） */
  asyncResponseMs: number
  /** 单个插件的总超时（毫秒） */
  pluginTimeoutMs: number
  /** 单次请求子请求预算 */
  subrequestBudget: number
  cacheTtlSec: number
  partialCacheTtlSec: number
  /** 单次请求最多搜索的 TG 频道数（防止频道过多吃光子请求预算） */
  maxTgChannels: number
  maxPagesYunsou: number
  maxPagesCldi: number
  debugRoutes: boolean
}

function num(v: string | undefined, def: number, min = 1): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= min ? n : def
}

function list(v: string | undefined, def: string[]): string[] {
  if (v === undefined) return def
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function loadConfig(env: Env): AppConfig {
  return {
    defaultChannels: list(env.CHANNELS, ['tgsearchers7']),
    // 与原项目一致：必须显式指定，未指定则不启用任何插件
    enabledPlugins: list(env.ENABLED_PLUGINS, []).map((s) => s.toLowerCase()),
    asyncResponseMs: num(env.ASYNC_RESPONSE_TIMEOUT, 4) * 1000,
    pluginTimeoutMs: num(env.PLUGIN_TIMEOUT, 25) * 1000,
    subrequestBudget: num(env.SUBREQUEST_BUDGET, 48),
    cacheTtlSec: num(env.CACHE_TTL, 60) * 60,
    partialCacheTtlSec: num(env.CACHE_PARTIAL_TTL_MINUTES, 3) * 60,
    maxTgChannels: num(env.MAX_TG_CHANNELS, 1),
    maxPagesYunsou: num(env.MAX_PAGES_YUNSOU, 3),
    maxPagesCldi: num(env.MAX_PAGES_CLDI, 3),
    debugRoutes: env.DEBUG_ROUTES === 'true',
  }
}
