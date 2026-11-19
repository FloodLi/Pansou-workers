// 合成数据，依据 Go serovalDecoder 的逻辑构造，非真实抓取。
import { describe, expect, it } from 'vitest'
import { SerovalDecoder, type SerovalNode } from '../../src/plugins/_helpers/seroval'

const s = (v: string): SerovalNode => ({ t: 1, s: v })
const obj = (o: Record<string, SerovalNode>, i?: number): SerovalNode => ({
  t: 10,
  ...(i === undefined ? {} : { i }),
  p: { k: Object.keys(o), v: Object.values(o) },
})

describe('SerovalDecoder', () => {
  it('objectValue / stringValue 读取普通节点', () => {
    const root = obj({ a: s('x'), b: { t: 9, a: [s(' y '), s(' '), { t: 2 }] } })
    const d = new SerovalDecoder(root)
    expect(d.stringValue(d.objectValue(root, 'a'))).toBe('x')
    expect(d.stringArray(d.objectValue(root, 'b'))).toEqual(['y'])
    expect(d.objectValue(root, 'missing')).toBeNull()
  })

  it('引用节点 t=4 跟随到带 i 的节点，包括多层引用', () => {
    const root = obj({
      first: { t: 4, s: 8 },
      store: obj({ v: { ...s('shared'), i: 7 }, w: { t: 4, s: 7, i: 8 } }, 3),
    })
    const d = new SerovalDecoder(root)
    // first -> 8（引用）-> 7（字符串）
    expect(d.stringValue(d.objectValue(root, 'first'))).toBe('shared')
    // 引用到不存在的 id、非整数引用 -> null
    expect(d.resolve({ t: 4, s: 999 })).toBeNull()
    expect(d.resolve({ t: 4, s: 'x' })).toBeNull()
  })

  it('循环引用最多跟随 16 层后停止', () => {
    const a: SerovalNode = { t: 4, s: 2, i: 1 }
    const b: SerovalNode = { t: 4, s: 1, i: 2 }
    const d = new SerovalDecoder({ t: 9, a: [a, b] })
    // 16 次迭代后仍是引用节点，不会死循环
    expect(d.resolve(a)?.t).toBe(4)
  })

  it('类型不符时返回空值', () => {
    const d = new SerovalDecoder(null)
    expect(d.stringValue({ t: 2, s: 'x' })).toBe('')
    expect(d.stringArray(s('x'))).toEqual([])
    expect(d.objectValue(null, 'k')).toBeNull()
  })
})
