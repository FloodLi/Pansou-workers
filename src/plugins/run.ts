import type { AppConfig } from '../config'
import { BudgetExceeded, type SubrequestBudget } from '../core/budget'
import { HttpClient, errMsg } from '../core/http'
import { getLinkType } from '../links'
import type { SearchResult } from '../types'
import type { Plugin, PluginContext } from './types'

export interface RunDeps {
  http: HttpClient
  config: AppConfig
  budget: SubrequestBudget
  ext: Record<string, unknown>
}

export type PluginOutcome =
  | { ok: true; plugin: string; results: SearchResult[] }
  | { ok: false; plugin: string; error: string; budgetExceeded: boolean }

/** 单插件隔离执行：超时、异常都不外溢，并对结果做规范化。 */
export async function runPlugin(plugin: Plugin, keyword: string, deps: RunDeps): Promise<PluginOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('插件超时')), deps.config.pluginTimeoutMs)
  const ctx: PluginContext = {
    http: deps.http.withTag(plugin.name),
    ext: deps.ext,
    signal: controller.signal,
    config: deps.config,
  }
  try {
    const raw = await Promise.race([
      plugin.search(keyword, ctx),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error(`[${plugin.name}] 插件超时`)), {
          once: true,
        }),
      ),
    ])
    return { ok: true, plugin: plugin.name, results: normalizeResults(plugin, raw) }
  } catch (e) {
    return { ok: false, plugin: plugin.name, error: errMsg(e), budgetExceeded: e instanceof BudgetExceeded }
  } finally {
    clearTimeout(timer)
  }
}

/** 强制约定：channel 为空；unique_id 以 `<name>-` 开头；链接补全类型；丢弃无链接结果。 */
export function normalizeResults(plugin: Plugin, results: SearchResult[]): SearchResult[] {
  const prefix = `${plugin.name}-`
  const out: SearchResult[] = []
  for (const r of results) {
    const links = r.links
      .filter((l) => l.url)
      .map((l) => ({ ...l, type: l.type || getLinkType(l.url), password: l.password ?? '' }))
    if (links.length === 0) continue
    out.push({
      ...r,
      channel: '',
      unique_id: r.unique_id.startsWith(prefix) ? r.unique_id : `${prefix}${r.unique_id}`,
      links,
    })
  }
  return out
}
