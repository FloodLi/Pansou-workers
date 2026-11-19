// 对应 util/regex_util.go 顶部的正则变量。Go 的 (?i) -> i 标志；所有正则在模块顶层预编译。
// 无 g 标志的版本用于 test/exec；带 g 的 *_G 版本只配合 matchAll / String.match 使用（不依赖 lastIndex）。

export const AllPanLinksPattern =
  /(?:(?:magnet:\?xt=urn:btih:[a-zA-Z0-9]+)|(?:ed2k:\/\/\|file\|[^|]+\|\d+\|[A-Fa-f0-9]+\|\/?)|(?:https?:\/\/(?:(?:[\w.-]+\.)?(?:pan\.(?:baidu|quark)\.cn|(?:www\.)?(?:alipan|aliyundrive)\.com|drive\.uc\.cn|cloud\.189\.cn|(?:www\.)?(?:yun|caiyun)\.139\.com|caiyun\.feixin\.10086\.cn|(?:www\.)?123(?:684|685|912|pan|592)\.(?:com|cn)|115\.com|115cdn\.com|anxia\.com|pan\.xunlei\.com|mypikpak\.com|guangyapan\.com))(?:\/[^\s'"<>()]*)?))/i

export const BaiduPanPattern = /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_-]+(?:\?pwd=[a-zA-Z0-9]{4})?/
export const QuarkPanPattern = /https?:\/\/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/
export const XunleiPanPattern = /https?:\/\/pan\.xunlei\.com\/s\/[a-zA-Z0-9]+(?:\?pwd=[a-zA-Z0-9]{4})?(?:#)?/
export const TianyiPanPattern = /https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+(?:%[0-9A-Fa-f]{2})*(?:（[^）]*）)?/
export const UCPanPattern = /https?:\/\/drive\.uc\.cn\/s\/[a-zA-Z0-9]+(?:\?public=\d)?/
export const Pan123Pattern =
  /https?:\/\/(?:www\.)?123(?:684|865|685|912|pan|592)\.(?:com|cn)\/s\/[a-zA-Z0-9_-]+(?:\?(?:%E6%8F%90%E5%8F%96%E7%A0%81|提取码)[:：][a-zA-Z0-9]+)?/
export const Pan115Pattern = /https?:\/\/(?:115\.com|115cdn\.com|anxia\.com)\/s\/[a-zA-Z0-9]+(?:\?password=[a-zA-Z0-9]{4})?(?:#)?/
export const AliyunPanPattern = /https?:\/\/(?:www\.)?(?:alipan|aliyundrive)\.com\/s\/[a-zA-Z0-9]+/
export const GuangyaPanPattern = /https?:\/\/(?:www\.)?guangyapan\.com\/s\/[a-zA-Z0-9_-]+/
export const MobilePanPattern =
  /https?:\/\/(?:(?:www\.)?yun\.139\.com\/shareweb\/#\/w\/i\/[a-zA-Z0-9]+|(?:www\.)?caiyun\.139\.com\/(?:w\/i\/[a-zA-Z0-9]+|m\/i\?[a-zA-Z0-9]+)[^\s<>"']*|caiyun\.feixin\.10086\.cn\/[a-zA-Z0-9]+)/

export const PasswordPattern = /(?:(?:提取|访问|提取密|密)码|pwd)[：:]\s*([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i
export const UrlPasswordPattern = /[?&]pwd=([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i
// 注意：Go 原文是 [：:\\s]（原始字符串里的 \\s 即"反斜杠或 s"），这里保持同样的字符集
export const NearbyPasswordPattern = /(?:(?:提取|访问|提取密|密)码|pwd)[：:\\s]*([a-zA-Z0-9]{4,6})(?:[^a-zA-Z0-9]|$)/i
// Go 的 . 不匹配 \n（但匹配 \r），所以用 [^\n] 而非 JS 的 .
export const BaiduPasswordPattern = /(?:链接：[^\n]*?提取码：|密码：|提取码：|pwd=|pwd:|pwd：)([a-zA-Z0-9]{4})(?:[^a-zA-Z0-9]|$)/i
export const TianyiAccessCodePattern = /(?:（访问码：|%EF%BC%88%E8%AE%BF%E9%97%AE%E7%A0%81%EF%BC%9A)([a-zA-Z0-9]+)(?:）|%EF%BC%89)/
export const XunleiPwdPattern = /\?pwd=([a-zA-Z0-9]{4})/
export const Pan115PasswordPattern = /password=([a-zA-Z0-9]{4})/
export const Pan123ExtractCodePattern = /(?:提取码|%E6%8F%90%E5%8F%96%E7%A0%81)[:：]([a-zA-Z0-9]+)/

const g = (re: RegExp) => new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')

export const AllPanLinksPattern_G = g(AllPanLinksPattern)
export const BaiduPanPattern_G = g(BaiduPanPattern)
export const QuarkPanPattern_G = g(QuarkPanPattern)
export const XunleiPanPattern_G = g(XunleiPanPattern)
export const TianyiPanPattern_G = g(TianyiPanPattern)
export const UCPanPattern_G = g(UCPanPattern)
export const Pan123Pattern_G = g(Pan123Pattern)
export const Pan115Pattern_G = g(Pan115Pattern)
export const AliyunPanPattern_G = g(AliyunPanPattern)
export const GuangyaPanPattern_G = g(GuangyaPanPattern)
export const MobilePanPattern_G = g(MobilePanPattern)

/** 搜索服务 mergeResultsByType 用：全部带 g，使用方只用 content.match(re) */
export const NETDISK_TITLE_PATTERNS: RegExp[] = [
  TianyiPanPattern_G,
  BaiduPanPattern_G,
  QuarkPanPattern_G,
  AliyunPanPattern_G,
  MobilePanPattern_G,
  UCPanPattern_G,
  Pan123Pattern_G,
  Pan115Pattern_G,
  XunleiPanPattern_G,
]

/** 对应 Go regexp.QuoteMeta */
export function quoteMeta(s: string): string {
  return s.replace(/[\\.+*?()|[\]{}^$]/g, '\\$&')
}

/** UTF-8 字节长度（Go len(string) 语义） */
export function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** 对应 Go strings.IndexAny：返回首个属于 chars（按码点）的字符偏移，没有返回 -1 */
export function indexAny(s: string, chars: string): number {
  const set = new Set(Array.from(chars))
  let i = 0
  for (const ch of s) {
    if (set.has(ch)) return i
    i += ch.length
  }
  return -1
}

/** 对应 Go strings.TrimSpace（仅处理常见空白，足够本场景） */
export function trimSpace(s: string): string {
  return s.trim()
}
