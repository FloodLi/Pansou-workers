import {
  BaiduPasswordPattern,
  Pan115PasswordPattern,
  Pan123ExtractCodePattern,
  PasswordPattern,
  TianyiAccessCodePattern,
  UrlPasswordPattern,
  XunleiPwdPattern,
  indexAny,
} from './patterns'

// 提取码后的结束字符集（对应 Go 里 IndexAny 的字符串，含空白、中文标点与 emoji 标记）
const CODE_END_CHARS =
  ' \t\n\r，。；;,🏷📁🔍📎🔗📌📋📂🗂️🔖📚📒📔📕📓📗📘📙📄📃📑🧾📊📈📉🗒️🗓️📆📅🗑️🔒🔓🔏🔐🔑🗝️'
const PAN123_HOSTS = ['123684.com', '123685.com', '123865.com', '123912.com', '123pan.com', '123pan.cn', '123592.com']

/**
 * 冒号后的内容，对应 strings.IndexAny(part, ":：") 及 part[codeStart+1:]。
 * Go 按字节只跳过 1 字节：遇到全角"：（3 字节）时 code 会以 2 个残缺字节开头，必然通不过
 * isValidPassword，所以全角冒号在这两个分支里永远取不到码（改走后面的正则）。
 * 这是 Go 的既有行为，这里忠实复刻（返回 null 表示该段无结果）。
 */
function afterColon(part: string): string | null {
  const i = indexAny(part, ':：')
  if (i >= 0 && part[i] === ':' && i + 1 < part.length) return part.slice(i + 1)
  return null
}

export function isValidPassword(p: string): boolean {
  return /^[0-9a-zA-Z]*$/.test(p)
}

/** 对应 Go ExtractPassword：url 内嵌 -> 内容里的"提取码"切分 -> 百度专用 -> 通用 */
export function extractPassword(content: string, url: string): string {
  if (url.includes('cloud.189.cn')) {
    const m = TianyiAccessCodePattern.exec(url)
    if (m) return m[1]!
  }
  if (url.includes('pan.xunlei.com') && url.includes('?pwd=')) {
    const m = XunleiPwdPattern.exec(url)
    if (m) return m[1]!
  }
  let m = UrlPasswordPattern.exec(url)
  if (m) return m[1]!

  if ((url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) && url.includes('password=')) {
    const pm = Pan115PasswordPattern.exec(url)
    if (pm) return pm[1]!
  }

  const is123 = PAN123_HOSTS.some((h) => url.includes(h))
  if (is123 && (url.includes('提取码') || url.includes('%E6%8F%90%E5%8F%96%E7%A0%81'))) {
    const cm = Pan123ExtractCodePattern.exec(url)
    if (cm) return cm[1]!
  }

  if (is123 && url.includes('提取码')) {
    const parts = url.split('提取码')
    if (parts.length > 1) {
      const rest = afterColon(parts[1]!)
      if (rest !== null) {
        let code = rest.trim()
        const endIdx = indexAny(code, CODE_END_CHARS)
        if (endIdx > 0) code = code.slice(0, endIdx)
        code = code.trim()
        // 有效码必为 ASCII，字符长度即字节长度
        if (code.length > 0 && code.length <= 6 && isValidPassword(code)) return code
      }
    }
  }

  if (content.includes('提取码')) {
    for (const part of content.split('提取码')) {
      if (part.length === 0) continue
      const rest = afterColon(part)
      if (rest === null) continue
      let code = rest.trim()
      const endIdx = indexAny(code, CODE_END_CHARS)
      if (endIdx > 0) {
        code = code.slice(0, endIdx)
      } else if (byteLenOver6(code)) {
        // 无明显结束标记：Go 在字节上取前 4~6 位里第一个合法的（即前 4 字节全为字母数字时取 4 位），
        // 否则退到 code[:4]（含非 ASCII 字节，随后必然校验失败）
        const k = /^[0-9a-zA-Z]*/.exec(code)![0].length
        code = k >= 4 ? code.slice(0, 4) : ''
      }
      code = code.trim()
      if (code !== '' && isValidPassword(code)) return code
    }
  }

  if (url.toLowerCase().includes('pan.baidu.com')) {
    const bm = BaiduPasswordPattern.exec(content)
    if (bm) return bm[1]!
  }

  m = PasswordPattern.exec(content)
  if (m) return m[1]!
  return ''
}

function byteLenOver6(s: string): boolean {
  // 字符数 > 6 必然字节数 > 6；字符数 ≤ 6 时再精确计算
  if (s.length > 6) return true
  return new TextEncoder().encode(s).length > 6
}
