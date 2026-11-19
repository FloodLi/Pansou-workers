import { getLinkType } from './classify'

// 对应 util/regex_util.go 的 Clean*PanURL 系列。偏移按 UTF-16 字符计（只用于比较/截断，与 Go 字节偏移等价）。

const BASE_MARKERS = [' ', '\n', '\t', '，', '。', '；', ';', ',']
const EMOJI_MARKERS = [
  '📁', '🔍', '标签', '🏷', '📎', '🔗', '📌', '📋', '📂', '🗂️', '🔖', '📚', '📒', '📔', '📕', '📓', '📗', '📘', '📙',
  '📄', '📃', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️',
]
const PAN123_DOMAINS = ['123684.com', '123685.com', '123865.com', '123912.com', '123pan.com', '123pan.cn', '123592.com']
const ENC_EXTRACT_CODE = '%E6%8F%90%E5%8F%96%E7%A0%81'

/** 找到最小的 >0 的结束标记位置并截断（Go 里 idx > 0 && idx < minEndIdx 的循环） */
function cutAtMarkers(url: string, markers: string[]): string {
  let min = url.length
  for (const m of markers) {
    const idx = url.indexOf(m)
    if (idx > 0 && idx < min) min = idx
  }
  return min < url.length ? url.slice(0, min) : url
}

/** 对应 Go net/url.QueryUnescape；非法 % 序列返回 null */
export function queryUnescape(s: string): string | null {
  if (/%(?![0-9A-Fa-f]{2})/.test(s)) return null
  const t = s.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(t)
  } catch {
    // 语法合法但字节不是合法 UTF-8：Go 会原样保留字节，这里退化为替换字符
    return t.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      const bytes = new Uint8Array(run.length / 3)
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16)
      return new TextDecoder().decode(bytes)
    })
  }
}

export function cleanBaiduPanURL(url: string): string {
  const start = url.indexOf('https://pan.baidu.com/s/')
  if (start < 0) return url
  url = url.slice(start)
  url = cutAtMarkers(url, [...BASE_MARKERS, '?pwd='].filter((m, i, a) => a.indexOf(m) === i))
  const pwdIdx = url.indexOf('?pwd=')
  if (pwdIdx >= 0 && url.length > pwdIdx + 5) {
    const end = pwdIdx + 9
    return end <= url.length ? url.slice(0, end) : url
  }
  return url
}

export function cleanTianyiPanURL(url: string): string {
  const start = url.indexOf('https://cloud.189.cn/t/')
  if (start < 0) return url
  url = cutAtMarkers(url.slice(start), [...BASE_MARKERS, '实时', '天翼', '更多'])
  return queryUnescape(url) ?? url
}

export function cleanUCPanURL(url: string): string {
  const start = url.indexOf('https://drive.uc.cn/s/')
  if (start < 0) return url
  url = url.slice(start)
  // 不能把分享码里合法的 "123" 当分隔符
  const cut = cutAtMarkers(url, [...BASE_MARKERS, '网盘', '夸克', '阿里', '百度'])
  if (cut.length < url.length) return cut
  const publicIdx = url.indexOf('?public=')
  if (publicIdx > 0) {
    return publicIdx + 9 <= url.length ? url.slice(0, publicIdx + 9) : url.slice(0, publicIdx + 8)
  }
  return url
}

/** 补协议头 / 去掉链接前的前缀文本（123、115、阿里共用的前半段） */
function fixScheme(url: string, startIdx: number): string {
  const hasProtocol = url.startsWith('http://') || url.startsWith('https://')
  if (!hasProtocol) return 'https://' + url.slice(startIdx)
  if (startIdx > 0) {
    const p = url.indexOf('://')
    if (p >= 0) return url.slice(0, p + 3) + url.slice(startIdx)
  }
  return url
}

export function clean123PanURL(url: string): string {
  if (!PAN123_DOMAINS.some((d) => url.includes(d + '/s/'))) return url
  let startIdx = -1
  for (const d of PAN123_DOMAINS) {
    const idx = url.indexOf(d + '/s/')
    if (idx >= 0) {
      startIdx = idx
      break
    }
  }
  if (startIdx < 0) return url
  url = fixScheme(url, startIdx)
  const cut = cutAtMarkers(url, [...BASE_MARKERS, ...EMOJI_MARKERS])
  if (cut.length < url.length) return cut
  // 统一使用非编码的"提取码"
  if (url.includes(ENC_EXTRACT_CODE)) url = url.replace(ENC_EXTRACT_CODE, '提取码')
  return url
}

export function clean115PanURL(url: string): string {
  if (!(url.includes('115.com/s/') || url.includes('115cdn.com/s/') || url.includes('anxia.com/s/'))) return url
  let startIdx = url.indexOf('115.com/s/')
  if (startIdx < 0) startIdx = url.indexOf('115cdn.com/s/')
  if (startIdx < 0) startIdx = url.indexOf('anxia.com/s/')
  if (startIdx < 0) return url
  url = fixScheme(url, startIdx)
  const pwdIdx = url.indexOf('?password=')
  if (pwdIdx > 0 && pwdIdx + 14 <= url.length) return url.slice(0, pwdIdx + 14)
  const hashIdx = url.indexOf('#')
  if (hashIdx > 0) return url.slice(0, hashIdx)
  return url
}

export function cleanAliyunPanURL(url: string): string {
  if (!(url.includes('alipan.com/s/') || url.includes('aliyundrive.com/s/'))) return url
  let startIdx = -1
  for (const k of ['www.alipan.com/s/', 'alipan.com/s/', 'www.aliyundrive.com/s/', 'aliyundrive.com/s/']) {
    const idx = url.indexOf(k)
    if (idx >= 0) {
      startIdx = idx
      break
    }
  }
  if (startIdx < 0) return url
  url = fixScheme(url, startIdx)
  return cutAtMarkers(url, [...BASE_MARKERS, ...EMOJI_MARKERS])
}

const MOBILE_PREFIXES = [
  'https://yun.139.com/shareweb/#/w/i/',
  'http://yun.139.com/shareweb/#/w/i/',
  'https://www.yun.139.com/shareweb/#/w/i/',
  'http://www.yun.139.com/shareweb/#/w/i/',
  'https://caiyun.139.com/w/i/',
  'http://caiyun.139.com/w/i/',
  'https://www.caiyun.139.com/w/i/',
  'http://www.caiyun.139.com/w/i/',
  'https://caiyun.139.com/m/i?',
  'http://caiyun.139.com/m/i?',
  'https://www.caiyun.139.com/m/i?',
  'http://www.caiyun.139.com/m/i?',
  'https://caiyun.feixin.10086.cn/',
  'http://caiyun.feixin.10086.cn/',
]

export function cleanMobilePanURL(url: string): string {
  let startIdx = -1
  for (const p of MOBILE_PREFIXES) {
    const idx = url.indexOf(p)
    if (idx >= 0) {
      startIdx = idx
      break
    }
  }
  if (startIdx < 0) return url
  url = cutAtMarkers(url.slice(startIdx), [...BASE_MARKERS, '访问码', '提取码', '密码', '链接', '网盘'])
  return url.trim()
}

/** 对应 Go normalizeAliyunPanURL（password 参数未使用，保留签名） */
export function normalizeAliyunPanURL(url: string, _password?: string): string {
  return cleanAliyunPanURL(url)
}

/** 按类型分派到对应 Clean*；其它类型只 trim（Go 侧没有对应函数） */
export function cleanLinkUrl(url: string, type: string = getLinkType(url)): string {
  switch (type) {
    case 'baidu':
      return cleanBaiduPanURL(url)
    case 'tianyi':
      return cleanTianyiPanURL(url)
    case 'uc':
      return cleanUCPanURL(url)
    case '123':
      return clean123PanURL(url)
    case '115':
      return clean115PanURL(url)
    case 'aliyun':
      return cleanAliyunPanURL(url)
    case 'mobile':
      return cleanMobilePanURL(url)
    default:
      return url.trim()
  }
}

