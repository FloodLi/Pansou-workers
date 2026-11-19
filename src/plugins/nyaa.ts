import { parseHtml, textOf, type HTMLElement } from '../core/html'
import { parseTime } from '../core/time'
import type { SearchResult } from '../types'
import { filterByKeyword, nowIso } from './_helpers/flarum'
import { definePlugin, makeResult } from './types'

const SITE_URL = 'https://nyaa.si'
const VIEW_ID_RE = /\/view\/(\d+)/

function parseRow(tr: HTMLElement): SearchResult | null {
  const category = tr.querySelector('td:nth-child(1) a')?.getAttribute('title') ?? ''

  // 标题链接：行内可能先有 "评论数" 链接（class=comments），优先取非评论链接
  const anchors = tr.querySelectorAll("td[colspan='2'] a")
  const titleLink = anchors.find((a) => !(a.getAttribute('class') ?? '').includes('comments')) ?? anchors[0]
  if (!titleLink) return null
  let title = textOf(titleLink)
  if (!title) title = (titleLink.getAttribute('title') ?? '').trim()
  const href = titleLink.getAttribute('href') ?? ''
  const id = VIEW_ID_RE.exec(href)?.[1]
  if (!id) return null

  const magnet = tr.querySelector("td.text-center a[href^='magnet:']")?.getAttribute('href')
  if (!magnet) return null

  const tds = tr.querySelectorAll('td.text-center')
  const size = textOf(tds[1])
  const ts = Number(tds.find((td) => td.hasAttribute('data-timestamp'))?.getAttribute('data-timestamp'))
  const datetime = Number.isFinite(ts) && ts > 0 ? parseTime(ts) : nowIso()

  let seeders = '0'
  let leechers = '0'
  let downloads = '0'
  if (tds.length >= 6) {
    seeders = textOf(tds[tds.length - 3])
    leechers = textOf(tds[tds.length - 2])
    downloads = textOf(tds[tds.length - 1])
  }
  const parts: string[] = []
  if (category) parts.push(`分类: ${category}`)
  if (size) parts.push(`大小: ${size}`)
  parts.push(`做种: ${seeders}`, `下载: ${leechers}`, `完成: ${downloads}`)
  const tags: string[] = []
  if (category) tags.push(category)
  tags.push(`做种:${seeders}`, `下载:${leechers}`, `完成:${downloads}`)

  return makeResult({
    plugin: 'nyaa',
    id,
    title,
    content: parts.join(' | '),
    datetime,
    links: [{ url: magnet, type: 'magnet' }],
    tags,
  })
}

export default definePlugin({
  name: 'nyaa',
  priority: 3,
  skipServiceFilter: true,
  async search(keyword, ctx) {
    // ext.title_en 存在时改用英文名搜索（nyaa 以英文/日文标题为主）
    const titleEn = ctx.ext.title_en
    const kw = typeof titleEn === 'string' && titleEn !== '' ? titleEn : keyword
    const url = `${SITE_URL}/?f=0&c=0_0&${new URLSearchParams({ q: kw })}`
    const html = await ctx.http.text(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
        Referer: SITE_URL,
      },
      retries: 2,
    })
    const root = parseHtml(html)
    const rows = root.querySelectorAll('table.torrent-list tbody tr')
    const results: SearchResult[] = []
    for (const tr of rows) {
      const r = parseRow(tr)
      if (r) results.push(r)
    }
    return filterByKeyword(results, kw)
  },
})
