import { cleanAliyunPanURL, clean115PanURL, clean123PanURL, cleanBaiduPanURL, cleanMobilePanURL, cleanTianyiPanURL, cleanUCPanURL } from './clean'
import {
  AliyunPanPattern_G,
  AllPanLinksPattern_G,
  BaiduPanPattern_G,
  GuangyaPanPattern_G,
  MobilePanPattern_G,
  Pan115Pattern_G,
  Pan123Pattern_G,
  QuarkPanPattern_G,
  TianyiPanPattern_G,
  UCPanPattern_G,
  XunleiPanPattern_G,
} from './patterns'

const ENC_EXTRACT_CODE = '%E6%8F%90%E5%8F%96%E7%A0%81'

/** 对应 Go normalizeURLForComparison：去协议头，统一提取码编码 */
export function normalizeURLForComparison(url: string): string {
  const idx = url.indexOf('://')
  if (idx >= 0) url = url.slice(idx + 3)
  if (url.includes(ENC_EXTRACT_CODE)) url = url.replace(ENC_EXTRACT_CODE, '提取码')
  return url
}

const SKIP_IN_GENERIC = [
  'pan.baidu.com',
  'pan.quark.cn',
  'pan.xunlei.com',
  'guangyapan.com',
  'cloud.189.cn',
  'drive.uc.cn',
  'yun.139.com',
  'caiyun.139.com',
  'caiyun.feixin.10086.cn',
  '123684.com',
  '123685.com',
  '123865.com',
  '123912.com',
  '123pan.com',
  '123pan.cn',
  '123592.com',
]

function stripHttps(u: string): string {
  return u.endsWith('https') ? u.slice(0, -5) : u
}

/** 从文本中提取全部网盘/磁力/ed2k 链接（对应 Go ExtractNetDiskLinks，含其各类型的去重差异） */
export function extractNetDiskLinks(text: string): string[] {
  const links: string[] = []
  // 与 links 平行的"规范化后"缓存，避免去重时重复计算
  const norms: string[] = []
  const push = (u: string) => {
    links.push(u)
    norms.push(normalizeURLForComparison(u))
  }
  const dupNorm = (u: string): boolean => {
    const n = normalizeURLForComparison(u)
    return norms.some((e) => e === n)
  }

  // 百度/天翼/UC：不去重
  const plain = (re: RegExp, clean: (u: string) => string) => {
    for (const m of text.matchAll(re)) {
      const u = stripHttps(clean(m[0]))
      if (u !== '') push(u)
    }
  }
  plain(BaiduPanPattern_G, cleanBaiduPanURL)
  plain(TianyiPanPattern_G, cleanTianyiPanURL)
  plain(UCPanPattern_G, cleanUCPanURL)

  // 123/115/阿里/光鸭/移动：规范化后完全相等才去重
  const dedup = (re: RegExp, clean: (u: string) => string) => {
    for (const m of text.matchAll(re)) {
      const u = stripHttps(clean(m[0]))
      if (u !== '' && !dupNorm(u)) push(u)
    }
  }
  dedup(Pan123Pattern_G, clean123PanURL)
  dedup(Pan115Pattern_G, clean115PanURL)
  dedup(AliyunPanPattern_G, cleanAliyunPanURL)
  dedup(GuangyaPanPattern_G, (u) => u.trim())
  dedup(MobilePanPattern_G, cleanMobilePanURL)

  // 夸克/迅雷：与已有链接互相包含即视为重复
  const containsDedup = (re: RegExp) => {
    for (const m of text.matchAll(re)) {
      const u = stripHttps(m[0])
      if (!links.some((e) => e.includes(u) || u.includes(e))) push(u)
    }
  }
  containsDedup(QuarkPanPattern_G)
  containsDedup(XunleiPanPattern_G)

  // 通用模式：补充 magnet/ed2k/pikpak 等，已单独处理的域名跳过
  for (const m of text.matchAll(AllPanLinksPattern_G)) {
    const u = stripHttps(m[0])
    if (SKIP_IN_GENERIC.some((d) => u.includes(d))) continue
    const n = normalizeURLForComparison(u)
    if (!norms.some((e) => e === n || e.includes(n) || n.includes(e))) push(u)
  }
  return links
}
