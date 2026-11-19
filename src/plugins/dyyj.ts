import { parseHtml, type HTMLElement } from '../core/html'
import { parseTime } from '../core/time'
import { ZERO_TIME } from '../types'
import { fetchFlarumDiscussions, filterByKeyword, nowIso } from './_helpers/flarum'
import { definePlugin, makeResult } from './types'

const BASE_URL = 'https://bbs.dyyjmax.org'
const MAX_RESULTS = 100

const TEXT_PWD = [/提取码[:：]?\s*([A-Za-z0-9]{4,8})/, /密码[:：]?\s*([A-Za-z0-9]{4,8})/, /pwd\s*[=:：]\s*([A-Za-z0-9]{4,8})/]
const URL_PWD = [/[?&]pwd=([A-Za-z0-9]{4,8})/, /[?&]password=([A-Za-z0-9]{4,8})/, /[?&]code=([A-Za-z0-9]{4,8})/]

function firstMatch(res: RegExp[], s: string): string {
  for (const re of res) {
    const m = re.exec(s)
    if (m?.[1]) return m[1]
  }
  return ''
}

/** 与 Go determineCloudType 一致（比通用 getLinkType 多 uc/pikpak 等判断顺序）。 */
function cloudType(url: string): string {
  const has = (...s: string[]) => s.some((x) => url.includes(x))
  if (has('pan.quark.cn')) return 'quark'
  if (has('drive.uc.cn')) return 'uc'
  if (has('pan.baidu.com')) return 'baidu'
  if (has('aliyundrive.com', 'alipan.com')) return 'aliyun'
  if (has('pan.xunlei.com')) return 'xunlei'
  if (has('cloud.189.cn')) return 'tianyi'
  if (has('caiyun.139.com')) return 'mobile'
  if (has('115.com', '115cdn.com', 'anxia.com')) return '115'
  if (has('123684.com', '123685.com', '123912.com', '123pan.com', '123pan.cn', '123592.com')) return '123'
  if (has('mypikpak.com')) return 'pikpak'
  if (has('magnet:')) return 'magnet'
  if (has('ed2k://')) return 'ed2k'
  return 'others'
}

function extractLinks(root: HTMLElement) {
  const links: { url: string; type: string; password: string }[] = []
  const seen = new Set<string>()
  for (const a of root.querySelectorAll('a[href]')) {
    const href = (a.getAttribute('href') ?? '').trim()
    if (!href || seen.has(href)) continue
    const type = cloudType(href)
    if (type === 'others') continue
    let password = firstMatch(URL_PWD, href)
    if (!password) {
      const parent = a.parentNode as HTMLElement | null
      password = firstMatch(TEXT_PWD, a.text + (parent ? ` ${parent.text}` : ''))
    }
    links.push({ url: href, type, password })
    seen.add(href)
  }
  return links
}

export default definePlugin({
  name: 'dyyj',
  priority: 2,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    // 只用 API 内联的 mostRelevantPost：原版的 HTML 详情页回退会被 Cloudflare 挑战拦截且扇出爆子请求，已删除
    const discussions = await fetchFlarumDiscussions(ctx, {
      base: BASE_URL,
      keyword,
      include: 'mostRelevantPost',
      limit: MAX_RESULTS,
      retries: 2,
      headers: {
        Accept: 'application/vnd.api+json, application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: `${BASE_URL}/`,
      },
    })
    const results = []
    for (const d of discussions) {
      const root = parseHtml(d.contentHtml)
      const links = extractLinks(root)
      if (links.length === 0) continue
      let datetime = parseTime(d.createdAt)
      if (datetime === ZERO_TIME) datetime = nowIso()
      results.push(
        makeResult({
          plugin: 'dyyj',
          id: d.id,
          title: d.title.trim(),
          content: root.text.trim(),
          datetime,
          links,
        }),
      )
    }
    return filterByKeyword(results, keyword)
  },
})
