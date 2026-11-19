import { parse, type HTMLElement } from 'node-html-parser'

export type { HTMLElement }

/**
 * 解析 HTML。选用 node-html-parser 而非 cheerio：免费版每次请求 CPU 时间仅 10ms，
 * 它比基于 parse5 的 cheerio 快数倍。仅支持常用 CSS 选择器，复杂选择需改用正则。
 */
export function parseHtml(html: string): HTMLElement {
  return parse(html, { blockTextElements: { script: false, style: false, noscript: false } })
}

/** 取元素的纯文本并折叠空白。 */
export function textOf(el: HTMLElement | null | undefined): string {
  return el ? el.text.replace(/\s+/g, ' ').trim() : ''
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 等价于 Go 的 html.UnescapeString（覆盖常用实体与数字实体）。 */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
