import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALL_PLUGINS } from '../../src/plugins'
import { selectPlugins } from '../../src/plugins/registry'
import { definePlugin } from '../../src/plugins/types'

/** 与 Go 版 main.go / 各插件 NewBaseAsyncPlugin 核对过的 name/priority/skipServiceFilter。 */
const EXPECTED: Record<string, [number, boolean]> = {
  haitunsou: [2, false],
  quarkres: [2, false],
  ouge: [2, false],
  wanou: [1, false],
  dyyj: [2, false],
  ikantv: [3, false],
  meitizy: [2, false],
  melost: [3, false],
  nyaa: [3, true],
  quarksoo: [3, false],
  zlxapp: [3, false],
  feikuai: [3, true],
  xiaokupan: [2, false],
  quark4k: [3, true],
  yunso: [3, false],
  yunsou: [2, false],
  cldi: [3, true],
}

describe('插件注册', () => {
  it('阶段 1 的 17 个插件全部注册，name 唯一且小写，priority/skipServiceFilter 与 Go 版一致', () => {
    const names = ALL_PLUGINS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const p of ALL_PLUGINS) {
      expect(p.name).toBe(p.name.toLowerCase())
      expect([p.priority, p.skipServiceFilter]).toEqual(EXPECTED[p.name])
    }
  })

  it('wrangler.toml 的 ENABLED_PLUGINS 与已注册插件一致', () => {
    const raw = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf-8')
    const m = raw.match(/^ENABLED_PLUGINS\s*=\s*"([^"]*)"/m)
    expect(m).not.toBeNull()
    const enabled = (m?.[1] ?? '').split(',').map((s) => s.trim()).sort()
    expect(enabled).toEqual(Object.keys(EXPECTED).sort())
  })

  it('没有任何插件还是"尚未实现"的占位', () => {
    for (const name of Object.keys(EXPECTED)) {
      const src = readFileSync(new URL(`../../src/plugins/${name}.ts`, import.meta.url), 'utf-8')
      expect(src, name).not.toContain('尚未实现')
    }
  })
})

describe('selectPlugins', () => {
  const mk = (name: string) => definePlugin({ name, priority: 3, skipServiceFilter: false, async search() { return [] } })
  const all = [mk('a'), mk('b'), mk('c')]

  it('只运行已启用的插件', () => {
    expect(selectPlugins(all, ['a', 'b']).map((p) => p.name)).toEqual(['a', 'b'])
    expect(selectPlugins(all, []).map((p) => p.name)).toEqual([])
  })
  it('请求 plugins 取交集，大小写不敏感，空白被忽略', () => {
    expect(selectPlugins(all, ['a', 'b', 'c'], [' B ', 'zzz']).map((p) => p.name)).toEqual(['b'])
  })
  it('请求列出全部已启用插件等价于不指定', () => {
    expect(selectPlugins(all, ['a', 'b'], ['b', 'a', 'c']).map((p) => p.name)).toEqual(['a', 'b'])
    expect(selectPlugins(all, ['a', 'b'], ['']).map((p) => p.name)).toEqual(['a', 'b'])
  })
})
