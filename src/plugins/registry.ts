import type { Plugin } from './types'

/** 按 ENABLED_PLUGINS 与请求 plugins 参数选出要运行的插件（大小写不敏感）。 */
export function selectPlugins(all: Plugin[], enabled: string[], requested?: string[]): Plugin[] {
  const enabledSet = new Set(enabled.map((s) => s.toLowerCase()))
  const active = all.filter((p) => enabledSet.has(p.name))
  const req = (requested ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  // 未指定，或列出了全部已启用插件 → 全量
  if (req.length === 0) return active
  const reqSet = new Set(req)
  if (active.every((p) => reqSet.has(p.name))) return active
  return active.filter((p) => reqSet.has(p.name))
}
