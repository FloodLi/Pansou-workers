import { NETDISK_TITLE_PATTERNS, normalizeUrl } from '../links'

// 移植自 service/search_service.go 的链接-标题对应逻辑（extractLinkTitlePairs 系列）。

const URL_RE = /https?:\/\/[^\s"']+/g
const URL_TEST_RE = /https?:\/\/[^\s"']+/
const TITLE_TAIL_RE = /([^链地资网\s]+?(?:\([^)]+\))?(?:\s*\d+K)?(?:\s*臻彩)?(?:\s*MAX)?(?:\s*HDR)?(?:\s*更(?:新)?\d+集))$/
const EMOJI_RE = /[\p{So}\p{Sk}]/gu

const TITLE_PREFIXES = ['名称：', '标题：', '片名：', '名称:', '标题:', '片名:']

const LINK_LINE_PREFIXES = ['链接：', '地址：', '资源地址：', '网盘：', '网盘地址：', '链接:']

const STANDARD_PREFIX_WORDS = new Set(['链接', '地址', '资源地址', '网盘', '网盘地址'])

const CLOUD_DISK_NAMES = new Set([
  '夸克', '夸克网盘', 'quark', '夸克云盘',
  '百度', '百度网盘', 'baidu', '百度云', 'bdwp', 'bdpan',
  '迅雷', '迅雷网盘', 'xunlei', '迅雷云盘',
  '115', '115网盘', '115云盘',
  '123', '123pan', '123网盘', '123云盘',
  '阿里', '阿里云', '阿里云盘', 'aliyun', 'alipan', '阿里网盘',
  '光鸭', '光鸭云盘', '光鸭网盘', 'guangya',
  '天翼', '天翼云', '天翼云盘', 'tianyi', '天翼网盘',
  'uc', 'uc网盘', 'uc云盘',
  '移动', '移动云', '移动云盘', 'caiyun', '彩云',
  'pikpak', 'pikpak网盘',
])

export function cleanTitle(title: string): string {
  let t = title.trim()
  for (const p of TITLE_PREFIXES) if (t.startsWith(p)) t = t.slice(p.length)
  return t.replace(EMOJI_RE, '').trim()
}

export function isLinkLine(line: string): boolean {
  const l = line.toLowerCase()
  return LINK_LINE_PREFIXES.some((p) => l.startsWith(p))
}

export function isLinkPrefix(text: string): boolean {
  const t = text.toLowerCase().trim()
  return STANDARD_PREFIX_WORDS.has(t) || CLOUD_DISK_NAMES.has(t)
}

function extractTitleFromLinkLine(line: string): string {
  // "标题：链接"（全角冒号），再试半角
  for (const sep of ['：', ':']) {
    const i = line.indexOf(sep)
    if (i < 0) continue
    const head = line.slice(0, i)
    if (!head.includes('http') && !isLinkPrefix(head)) return cleanTitle(head)
  }
  return ''
}

function extractTitleBeforeLink(text: string): string {
  const t = text.trim()
  const idx = t.indexOf('链接：')
  if (idx > 0) return cleanTitle(t.slice(0, idx))
  const m = t.match(TITLE_TAIL_RE)
  if (m?.[1]) return cleanTitle(m[1])
  return cleanTitle(t)
}

function withNewlines(content: string): Map<string, string> {
  const map = new Map<string, string>()
  const lines = content.split('\n')
  let lastTitle = ''
  let lastTitleIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (line === '') continue
    const links = line.match(URL_RE)
    if (links && links.length > 0) {
      const standard = isLinkLine(line)
      if (standard && lastTitle !== '') {
        for (const l of links) map.set(l, lastTitle)
      } else if (!standard) {
        const fromLine = extractTitleFromLinkLine(line)
        if (fromLine !== '') for (const l of links) map.set(l, fromLine)
        else if (lastTitle !== '') for (const l of links) map.set(l, lastTitle)
      }
    } else if (i + 1 < lines.length) {
      const next = (lines[i + 1] ?? '').trim()
      if (isLinkLine(next) || URL_TEST_RE.test(next)) {
        lastTitle = cleanTitle(line)
        lastTitleIndex = i
      }
    } else {
      lastTitle = cleanTitle(line)
      lastTitleIndex = i
    }
  }

  // 第二遍：给仍无标题的链接找最近的上文标题
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (line === '') continue
    const links = line.match(URL_RE)
    if (!links) continue
    for (const link of links) {
      if (map.has(link)) continue
      for (let j = i - 1; j >= 0; j--) {
        const cur = lines[j] ?? ''
        const nxt = lines[j + 1]
        if (j === lastTitleIndex || (nxt !== undefined && URL_TEST_RE.test(nxt) && !URL_TEST_RE.test(cur))) {
          const cand = cleanTitle(cur)
          if (cand !== '') {
            map.set(link, cand)
            break
          }
        }
      }
    }
  }
  return map
}

function withoutNewlines(content: string): Map<string, string> {
  const map = new Map<string, string>()
  const found: { url: string; pos: number }[] = []
  for (const re of NETDISK_TITLE_PATTERNS) {
    for (const m of content.match(re) ?? []) {
      const pos = content.indexOf(m)
      if (pos >= 0) found.push({ url: m, pos })
    }
  }
  found.sort((a, b) => a.pos - b.pos)

  const seen = new Set<string>()
  const links: string[] = []
  for (const f of found) {
    const n = normalizeUrl(f.url)
    if (seen.has(n)) continue
    seen.add(n)
    links.push(f.url)
  }
  if (links.length === 0) return map

  const segments: string[] = new Array(links.length + 1).fill('')
  let lastPos = 0
  links.forEach((link, i) => {
    const idx = content.slice(lastPos).indexOf(link)
    if (idx === -1) return
    const pos = idx + lastPos
    if (pos > lastPos) segments[i] = content.slice(lastPos, pos)
    lastPos = pos + link.length
  })
  if (lastPos < content.length) segments[links.length] = content.slice(lastPos)

  links.forEach((link, i) => {
    const title = extractTitleBeforeLink(segments[i] ?? '')
    if (title !== '') map.set(link, title)
  })
  return map
}

/** 从消息内容里抽取 链接 → 标题 的对应关系。 */
export function extractLinkTitlePairs(content: string): Map<string, string> {
  return content.includes('\n') ? withNewlines(content) : withoutNewlines(content)
}

/** 保留最前一个关键词之前的部分（对应 util.CutTitleByKeywords）。 */
export function cutTitleByKeywords(title: string, keywords: string[]): string {
  let minIdx = -1
  for (const kw of keywords) {
    const idx = title.indexOf(kw)
    if (idx >= 0 && (minIdx === -1 || idx < minIdx)) minIdx = idx
  }
  return (minIdx > 0 ? title.slice(0, minIdx) : title).trim()
}

const LINK_PREFIXES = ['天翼链接：', '百度链接：', '夸克链接：', '阿里链接：', 'UC链接：', '115链接：', '迅雷链接：', '123链接：', '链接：']
// Go 源码里用于切分标题的分隔字符集合
const SPLIT_CHARS = new Set([' ', '窃', '东', '迎', '千', '我', '恋', '将', '野', '合', '集', '天', '翼', '网', '盘', '(', '（'])

/** 内容无换行、且链接-标题对应为空时的回退：按"xx链接："前缀切分出标题。 */
export function titlesFromPrefixSplit(content: string, linkUrls: string[]): Map<string, string> {
  const map = new Map<string, string>()
  let parts: string[] = []
  for (const prefix of LINK_PREFIXES) {
    if (content.includes(prefix)) {
      parts = content.split(prefix)
      break
    }
  }
  if (parts.length > 1 && linkUrls.length <= parts.length - 1) {
    const titles: string[] = [cleanTitle(parts[0] ?? '')]
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i] ?? ''
      let linkEnd = -1
      for (let j = 0; j < part.length; j++) {
        if (SPLIT_CHARS.has(part[j] as string)) {
          linkEnd = j
          break
        }
      }
      if (linkEnd > 0) titles.push(cleanTitle(part.slice(linkEnd)))
    }
    linkUrls.forEach((u, i) => {
      const t = titles[i]
      if (t !== undefined) map.set(u, t)
    })
  }
  return map
}
