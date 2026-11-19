// 对应 util/parser_util.go 中不依赖 goquery 的纯字符串函数。
import {
  clean115PanURL,
  clean123PanURL,
  cleanBaiduPanURL,
  cleanTianyiPanURL,
  cleanUCPanURL,
  queryUnescape,
} from './clean'
import { extractPassword, isValidPassword } from './password'
import {
  AllPanLinksPattern,
  BaiduPanPattern,
  GuangyaPanPattern,
  MobilePanPattern,
  NearbyPasswordPattern,
  Pan115Pattern,
  Pan123Pattern,
  QuarkPanPattern,
  TianyiPanPattern,
  UCPanPattern,
  XunleiPanPattern,
  utf8Len,
} from './patterns'

/** URL 解码（QueryUnescape 语义），失败返回原值，用于去重 */
export function normalizeUrl(rawUrl: string): string {
  return queryUnescape(rawUrl) ?? rawUrl
}

const SUPPORTED_PATTERNS = [
  BaiduPanPattern,
  TianyiPanPattern,
  UCPanPattern,
  Pan123Pattern,
  GuangyaPanPattern,
  QuarkPanPattern,
  XunleiPanPattern,
  Pan115Pattern,
  MobilePanPattern,
  AllPanLinksPattern,
]

export function isSupportedLink(url: string): boolean {
  const lower = url.toLowerCase()
  return SUPPORTED_PATTERNS.some((re) => re.test(lower))
}

export function normalizeBaiduPanURL(url: string, password: string): string {
  url = cleanBaiduPanURL(url)
  if (url.includes('?pwd=')) return url
  if (password !== '') {
    if (password.length > 4) password = password.slice(0, 4)
    return url + '?pwd=' + password
  }
  return url
}
export const normalizeTianyiPanURL = (url: string, _password?: string): string => cleanTianyiPanURL(url)
export const normalizeUCPanURL = (url: string, _password?: string): string => cleanUCPanURL(url)
export const normalize123PanURL = (url: string, _password?: string): string => clean123PanURL(url)
export const normalize115PanURL = (url: string, _password?: string): string => clean115PanURL(url)
export { normalizeAliyunPanURL } from './clean'

/** 先用链接附近的短窗口取码，取不到退回整条扫描（保证不退化） */
export function passwordFor(linkURL: string, primaryContext: string, fallbackContext: string): string {
  const pw = extractCodeNear(linkURL, primaryContext)
  if (pw !== '') return pw
  return extractPassword(fallbackContext, linkURL)
}

const NEARBY_WINDOW = 60

/** 链接在正文里可能的写法，越精确越先试 */
export function anchorCandidates(linkURL: string): string[] {
  let trimmed = linkURL
  const q = trimmed.search(/[?#]/)
  if (q > 0) trimmed = trimmed.slice(0, q)
  trimmed = trimmed.replace(/\/+$/, '')

  const candidates = [trimmed]
  let noScheme = trimmed
  const i = noScheme.indexOf('//')
  if (i >= 0) noScheme = noScheme.slice(i + 2)
  const noWWW = noScheme.startsWith('www.') ? noScheme.slice(4) : noScheme

  if (noWWW !== noScheme) candidates.push(noWWW)
  if (noScheme !== trimmed) candidates.push(noScheme)

  // 路径末段（太短的不试：4 字符以内容易撞上别的东西）；长度按 UTF-8 字节
  const li = noWWW.lastIndexOf('/')
  if (li >= 0 && utf8Len(noWWW.slice(li + 1)) > 5) candidates.push(noWWW.slice(li))
  return candidates
}

/** 以 linkURL 为锚，只在其后一小段（到下一个 http 为止，至多 60 字节）找提取码 */
export function extractCodeNear(linkURL: string, context: string): string {
  if (context === '') return ''

  let window = ''
  for (const anchor of anchorCandidates(linkURL)) {
    const pos = context.indexOf(anchor)
    if (pos < 0) continue
    let rest = context.slice(pos + anchor.length)
    const next = rest.indexOf('http')
    if (next >= 0) rest = rest.slice(0, next)
    window = rest
    break
  }

  if (window === '') {
    // 短上下文（按钮标签）本身就是这条链接的上下文；长上下文定位不到则返回空让调用方回退
    if (context.length <= 2 * NEARBY_WINDOW && utf8Len(context) <= 2 * NEARBY_WINDOW) window = context
    else return ''
  }

  // Go 按 60 字节截断并回退到 rune 边界；字符数 >= 字节数的下界，先按 60 个 UTF-16 单元粗切再精确到字节
  window = cutUtf8(window.slice(0, NEARBY_WINDOW), NEARBY_WINDOW)

  const m = NearbyPasswordPattern.exec(window)
  if (m && isValidPassword(m[1]!)) return m[1]!
  return ''
}

/** 取前 maxBytes 个 UTF-8 字节对应的完整字符前缀 */
function cutUtf8(s: string, maxBytes: number): string {
  let bytes = 0
  let i = 0
  while (i < s.length) {
    const c = s.charCodeAt(i)
    let w = 3
    let step = 1
    if (c < 0x80) w = 1
    else if (c < 0x800) w = 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      w = 4
      step = 2
    }
    if (bytes + w > maxBytes) break
    bytes += w
    i += step
  }
  return s.slice(0, i)
}
