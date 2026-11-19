// 从 HTML 内联脚本里抽取 JS 字面量（haitunsou / zlxapp 共用）。
// 用 indexOf/正则跳跃扫描而不是逐字符循环，大页面（数 MB）下 CPU 才压得住。

/** 找到以 quote 结束的字符串的结尾引号下标（start 为开引号之后的位置）；未闭合返回 -1。 */
export function findStringEnd(text: string, start: number, quote: string): number {
  let pos = start
  while (true) {
    const i = text.indexOf(quote, pos)
    if (i < 0) return -1
    // 引号前连续反斜杠为奇数个时是被转义的引号
    let bs = 0
    while (i - 1 - bs >= start && text.charCodeAt(i - 1 - bs) === 92) bs++
    if (bs % 2 === 0) return i
    pos = i + 1
  }
}

const SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '0': '\0',
}

/** 解码 JS 单引号字符串的转义（\xNN、\uNNNN、\'、\\、行续接等）。非法转义抛错，与 Go 版一致。 */
export function decodeJsString(encoded: string): string {
  if (!encoded.includes('\\')) return encoded
  const out = encoded.replace(/\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r\n|[\s\S])|$)/g, (_m, u?: string, x?: string, c?: string) => {
    if (u !== undefined) return String.fromCharCode(parseInt(u, 16)) // 代理对逐个单元拼接即可还原
    if (x !== undefined) return String.fromCharCode(parseInt(x, 16))
    if (c === undefined) throw new Error('字符串以转义符结尾')
    if (c === 'u' || c === 'x') throw new Error('无效十六进制转义')
    if (c === '\n' || c === '\r\n' || c === '\r') return '' // 行续接
    return SIMPLE_ESCAPES[c] ?? c
  })
  return out
}

/**
 * 在 text 中按顺序找第一个命中的 marker（如 `const list = JSON.parse('`），
 * 返回其后单引号字符串解码后的内容。没有任何 marker 命中返回 null；字符串未闭合抛错。
 */
export function extractJsonParseString(text: string, markers: string[]): string | null {
  for (const marker of markers) {
    const idx = text.indexOf(marker)
    if (idx < 0) continue
    const start = idx + marker.length
    const end = findStringEnd(text, start, "'")
    if (end < 0) throw new Error('内嵌结果字符串未闭合')
    return decodeJsString(text.slice(start, end))
  }
  return null
}

/**
 * 抽取 marker 之后第一个 `[...]` 数组字面量的原文（括号配对，正确跳过字符串内的括号与引号）。
 * marker 未命中返回 null；缺少数组或未闭合抛错。
 */
export function extractArrayLiteral(text: string, marker: string): string | null {
  const idx = text.indexOf(marker)
  if (idx < 0) return null
  const start = text.indexOf('[', idx + marker.length)
  if (start < 0) throw new Error('缺少数组')
  const re = /["'\[\]]/g
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const ch = m[0]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, m.index + 1)
    } else {
      const end = findStringEnd(text, m.index + 1, ch)
      if (end < 0) throw new Error('数组未闭合')
      re.lastIndex = end + 1
    }
  }
  throw new Error('数组未闭合')
}

/**
 * JSON.parse，失败时把字符串内的裸控制字符转义后重试。
 * Go 版用的 JSON 库对此宽容，而站点内嵌脚本解码后可能含裸换行。
 */
export function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    const fixed = text.replace(/"(?:[^"\\]|\\[\s\S])*"/g, (str) =>
      str.replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')),
    )
    if (fixed === text) throw e
    return JSON.parse(fixed)
  }
}
