// TanStack Seroval 序列化节点树解码器（xiaokupan 专用，1:1 移植 Go 版 serovalDecoder，非通用实现）。
// 仅覆盖站点实际用到的节点：t=1 字符串、t=9 数组、t=10 对象、t=4 引用。

export interface SerovalProps {
  k?: string[] | null
  v?: (SerovalNode | null)[] | null
}

export interface SerovalNode {
  t: number
  i?: number
  s?: unknown
  p?: SerovalProps | null
  a?: (SerovalNode | null)[] | null
}

const MAX_REF_DEPTH = 16

export class SerovalDecoder {
  private readonly references = new Map<number, SerovalNode>()

  constructor(root: SerovalNode | null) {
    this.collect(root)
  }

  // 先收集所有带 i 的节点，引用节点（t=4）靠它回查
  private collect(node: SerovalNode | null | undefined): void {
    if (!node) return
    if (typeof node.i === 'number') this.references.set(node.i, node)
    for (const child of node.p?.v ?? []) this.collect(child)
    for (const child of node.a ?? []) this.collect(child)
  }

  /** 跟随引用节点（最多 16 层）；引用编号非整数或不存在时返回 null。 */
  resolve(node: SerovalNode | null | undefined): SerovalNode | null {
    let cur = node ?? null
    for (let depth = 0; cur && cur.t === 4 && depth < MAX_REF_DEPTH; depth++) {
      if (typeof cur.s !== 'number' || !Number.isInteger(cur.s)) return null
      cur = this.references.get(cur.s) ?? null
    }
    return cur
  }

  objectValue(node: SerovalNode | null | undefined, key: string): SerovalNode | null {
    const obj = this.resolve(node)
    if (!obj || !obj.p) return null
    const keys = obj.p.k ?? []
    const values = obj.p.v ?? []
    for (let index = 0; index < keys.length; index++) {
      if (keys[index] === key && index < values.length) return this.resolve(values[index])
    }
    return null
  }

  stringValue(node: SerovalNode | null | undefined): string {
    const n = this.resolve(node)
    if (!n || n.t !== 1 || typeof n.s !== 'string') return ''
    return n.s
  }

  stringArray(node: SerovalNode | null | undefined): string[] {
    const n = this.resolve(node)
    if (!n || n.t !== 9) return []
    const out: string[] = []
    for (const child of n.a ?? []) {
      const v = this.stringValue(child).trim()
      if (v) out.push(v)
    }
    return out
  }
}
