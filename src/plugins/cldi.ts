import { parseHtml, textOf, type HTMLElement } from '../core/html'
import { mapLimit } from '../core/pool'
import { parseTime } from '../core/time'
import type { SearchResult } from '../types'
import { filterByKeyword, nowIso } from './_helpers/flarum'
import { definePlugin, makeResult } from './types'

// 镜像域名存疑，改镜像只需改这里
const BASE_URL = 'https://cm7jll1f.1122137.xyz'

const AD_RE = /【[^】]*】/g
const HASH_PATH_RE = /\/hash\/([a-f0-9]{40})\.html/i
const DATE_RE = /添加时间[:：]\s*(\d{4}-\d{2}-\d{2})/
const FILE_SIZE_RE = /^(.+?)&nbsp;<span class="lightColor">([^<]+)<\/span>$/

function cleanTitle(t: string): string {
  return t.replace(AD_RE, '').trim().replace(/\s+/g, ' ')
}

const CATEGORY: Record<string, string> = {
  影视: '影视',
  音乐: '音乐',
  图像: '图像',
  文档书籍: '文档',
  压缩文件: '压缩包',
  安装包: '软件',
}

/** 无稳定 ID 的旧版页面：用磁力生成稳定 ID（原版用纳秒时间戳，不可复现）。 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function extractResults(root: HTMLElement): SearchResult[] {
  const results: SearchResult[] = []
  // 新版：article.resource，磁力由 /hash/<40位hex>.html 拼出，无需详情页
  for (const article of root.querySelectorAll('article.resource')) {
    const anchor = article.querySelector('h2 a[href]')
    const hash = HASH_PATH_RE.exec((anchor?.getAttribute('href') ?? '').trim())?.[1]?.toLowerCase()
    if (!anchor || !hash) continue
    const title = cleanTitle(anchor.text)
    if (!title) continue
    const content = article.querySelector('.meta')?.text.trim() ?? ''
    const d = DATE_RE.exec(content)?.[1]
    results.push(
      makeResult({
        plugin: 'cldi',
        id: hash,
        title,
        content,
        datetime: d ? parseTime(d) : nowIso(),
        links: [{ url: `magnet:?xt=urn:btih:${hash}`, type: 'magnet', workTitle: title }],
      }),
    )
  }
  if (results.length > 0) return results

  // 旧版：.tbox .ssbox
  for (const s of root.querySelectorAll('.tbox .ssbox')) {
    const titleSection = s.querySelector('.title h3')
    const category = textOf(titleSection?.querySelector('span')).replace(/^\[|\]$/g, '')
    const title = cleanTitle(textOf(titleSection?.querySelector('a')))
    const sbar = s.querySelector('.sbar')
    const magnet = sbar?.querySelector("a[href^='magnet:']")?.getAttribute('href')
    if (!title || !magnet) continue
    let datetime = nowIso()
    for (const span of sbar?.querySelectorAll('span') ?? []) {
      if (span.text.includes('添加时间:')) {
        const ts = textOf(span.querySelector('b'))
        const t = ts ? parseTime(ts) : ''
        if (t && !t.startsWith('0001')) datetime = t
      }
    }
    const files: string[] = []
    for (const li of s.querySelectorAll('.slist ul li')) {
      const m = FILE_SIZE_RE.exec(li.innerHTML)
      if (m) {
        const name = (m[1] ?? '').trim()
        const size = (m[2] ?? '').trim()
        if (name && size) files.push(`${name} (${size})`)
      } else {
        const text = li.text.trim()
        if (text) files.push(text)
      }
    }
    results.push(
      makeResult({
        plugin: 'cldi',
        id: fnv1a(magnet),
        title,
        content: files.join('\n'),
        datetime,
        links: [{ url: magnet, type: 'magnet' }],
        tags: category ? [CATEGORY[category] ?? '其他'] : [],
      }),
    )
  }
  return results
}

export default definePlugin({
  name: 'cldi',
  priority: 3,
  skipServiceFilter: true,
  async search(keyword, ctx) {
    const fetchPage = async (page: number) => {
      // 分类=0 全部，排序=2 按添加时间
      const url = `${BASE_URL}/search-${new URLSearchParams({ k: keyword }).toString().slice(2)}-0-2-${page}.html`
      const html = await ctx.http.text(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: `${BASE_URL}/`,
        },
        retries: 1, // 原版 3 次尝试；免费版预算紧，降为 2 次
      })
      return extractResults(parseHtml(html))
    }
    // 页数取配置而非写死 5；首页失败即整体失败，其余页失败忽略
    const maxPages = Math.max(1, ctx.config.maxPagesCldi)
    const first = await fetchPage(1)
    const rest = await mapLimit(
      Array.from({ length: maxPages - 1 }, (_, i) => i + 2),
      6,
      fetchPage,
    )
    const all = [...first]
    for (const r of rest) if (r.status === 'fulfilled') all.push(...r.value)
    return filterByKeyword(all, keyword)
  },
})
