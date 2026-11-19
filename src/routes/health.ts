import type { Context } from 'hono'
import { loadConfig } from '../config'
import { ALL_PLUGINS } from '../plugins'
import type { Env } from '../types'

export function healthHandler(c: Context<{ Bindings: Env }>): Response {
  const config = loadConfig(c.env)
  const enabled = new Set(config.enabledPlugins)
  const plugins = ALL_PLUGINS.filter((p) => enabled.has(p.name)).map((p) => p.name)
  return c.json({
    status: 'ok',
    auth_enabled: Boolean(c.env.API_TOKEN),
    plugins_enabled: plugins.length > 0,
    channels: config.defaultChannels,
    channels_count: config.defaultChannels.length,
    plugin_count: plugins.length,
    plugins,
    // Workers 版特有：便于核对免费版配额相关配置
    runtime: 'cloudflare-workers',
    subrequest_budget: config.subrequestBudget,
    cache: c.env.CACHE ? 'kv' : 'memory',
  })
}
