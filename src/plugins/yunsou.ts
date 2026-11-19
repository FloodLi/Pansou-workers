import { parseHtml, textOf, unescapeHtml, type HTMLElement } from '../core/html'
import { fulfilled, mapLimit } from '../core/pool'
import { cleanText, filterByKeyword, parseYmdOrNow, pathEscape, queryEscape } from './_helpers/text'
import { definePlugin, makeResult, type PluginContext } from './types'
import type { SearchResult } from '../types'

const BASE = 'https://wpys.cc'
// Go 每页最多尝试 3 次；免费版预算紧，降为额外重试 1 次，最坏 2N 个子请求（N=maxPagesYunsou）
const PAGE_RETRIES = 1
const MAX_RESULTS = 100
const PAGE_SIZE = 10

// 分享链接由 onclick="copyText(...,'url','pwd')" 提供
const COPY_TEXT_RE = /copyText\([^,]+,\s*'[^']*',\s*'([^']+)',\s*'([^']*)'/
const PWD_PARAM_RE = /[?&]pwd=([0-9a-zA-Z]+)/
const TOTAL_RE = /<el-pagination\b[^>]*?\s:total\s*=\s*(?:"([^"]*)"|'([^']*)')/i

function diskType(u: string): string {
  if (u.includes('pan.quark.cn')) return 'quark'
  if (u.includes('pan.baidu.com')) return 'baidu'
  if (u.includes('pan.xunlei.com')) return 'xunlei'
  if (u.includes('aliyundrive.com') || u.includes('alipan.com')) return 'aliyun'
  if (u.includes('drive.uc.cn')) return 'uc'
  return 'others'
}

async function fetchPage(ctx: PluginContext, keyword: string, page: number): Promise<string> {
  const kw = pathEscape(keyword)
  const path = page > 1 ? `${kw}-${page}` : kw
  return ctx.http.text(`${BASE}/s/${path}.html`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: `${BASE}/`,
    },
    retries: PAGE_RETRIES,
  })
}

export default definePlugin({
  name: 'yunsou',
  priority: 2,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    keyword = keyword.trim()
    if (!keyword) return []

    const first = await fetchPage(ctx, keyword, 1)
    let results = parseResults(first)

    // 总页数由分页组件的 :total 推出；上限取配置（免费版子请求预算紧，不写死 10）
    const rawTotal = TOTAL_RE.exec(first)
    const total = parseInt(rawTotal?.[1] ?? rawTotal?.[2] ?? '', 10) || 0
    const totalPages = Math.min(Math.max(Math.floor((total + PAGE_SIZE - 1) / PAGE_SIZE), 1), Math.max(1, ctx.config.maxPagesYunsou))

    if (totalPages > 1 && results.length < MAX_RESULTS) {
      // Go 是顺序翻页并在够 100 条时停；这里并发取，按页序合并后再截断。某页失败直接跳过（与 Go 的 continue 一致）
      const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
      const settled = await mapLimit(pages, 3, (p) => fetchPage(ctx, keyword, p))
      for (const h of fulfilled(settled)) results = results.concat(parseResults(h))
    }
    if (results.length > MAX_RESULTS) results = results.slice(0, MAX_RESULTS)
    return filterByKeyword(results, keyword)
  },
})

function parseResults(html: string): SearchResult[] {
  const out: SearchResult[] = []
  const root = parseHtml(html)
  for (const item of root.querySelectorAll('.list .item')) {
    if (out.length >= MAX_RESULTS) break
    let title = item.getAttribute('data-title') ?? ''
    if (!title) title = textOf(item.querySelector('.title'))
    title = cleanText(unescapeHtml(title))
    if (!title) continue

    const { shareUrl, password: declared } = findShare(item)
    if (!shareUrl) continue
    const password = declared || (PWD_PARAM_RE.exec(shareUrl)?.[1] ?? '')

    const source = cleanText(textOf(item.querySelector('.type')))
    out.push(
      makeResult({
        plugin: 'yunsou',
        id: queryEscape(shareUrl),
        title,
        content: source,
        datetime: parseYmdOrNow(textOf(item.querySelector('.type.time'))),
        links: [{ url: shareUrl, type: diskType(shareUrl), password }],
      }),
    )
  }
  return out
}

function findShare(item: HTMLElement): { shareUrl: string; password: string } {
  for (const el of item.querySelectorAll('*')) {
    // Vue 绑定在 HTML 中保留为 @click.stop 属性
    const onclick = el.getAttribute('onclick') || el.getAttribute('@click.stop') || ''
    if (!onclick) continue
    const m = COPY_TEXT_RE.exec(unescapeHtml(onclick))
    if (m) return { shareUrl: (m[1] ?? '').trim(), password: (m[2] ?? '').trim() }
  }
  return { shareUrl: '', password: '' }
}
