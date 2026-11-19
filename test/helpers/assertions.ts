import { expect } from 'vitest'
import type { Plugin } from '../../src/plugins/types'
import { normalizeResults } from '../../src/plugins/run'
import type { SearchResult } from '../../src/types'

/** 校验插件结果满足框架约定：channel 为空、unique_id 带前缀、链接非空且带类型、时间为 RFC3339。 */
export function expectValidPluginResults(plugin: Plugin, results: SearchResult[]): void {
  expect(results.length).toBeGreaterThan(0)
  for (const r of results) {
    expect(r.channel).toBe('')
    expect(r.unique_id.startsWith(`${plugin.name}-`)).toBe(true)
    expect(r.title).not.toBe('')
    expect(r.links.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(r.datetime))).toBe(false)
    for (const l of r.links) {
      expect(l.url).not.toBe('')
      expect(l.type).not.toBe('')
      expect(Number.isNaN(Date.parse(l.datetime))).toBe(false)
    }
  }
  // 规范化后不应丢失任何结果（即插件已自行满足约定）
  expect(normalizeResults(plugin, results).length).toBe(results.length)
}
