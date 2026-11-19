import { mapLimit } from '../core/pool'
import { parseTime } from '../core/time'
import { ZERO_TIME, type SearchResult } from '../types'
import { fetchFlarumDiscussions, filterByKeyword, nowIso } from './_helpers/flarum'
import { definePlugin, makeResult } from './types'

const BASE_URL = 'https://quark4k.com'
const PAGE_SIZE = 50
const PAGE_COUNT = 2
const INCLUDE = 'user,lastPostedUser,mostRelevantPost,mostRelevantPost.user,tags,tags.parent,firstPost'

const BR_RE = /<br\s*\/?>/g
const TAG_RE = /<[^>]*>/g

/** 对应 Go cleanHTML：br 转换行、去标签、解常用实体、去空行。 */
function cleanHtml(html: string): string {
  return html
    .replace(BR_RE, '\n')
    .replace(TAG_RE, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

function extractUrl(text: string): string {
  let start = -1
  for (const prefix of ['http://', 'https://']) {
    const pos = text.indexOf(prefix)
    if (pos !== -1) {
      start = pos
      break
    }
  }
  if (start === -1) return ''
  let end = text.length
  for (const ch of [' ', '\t', '\n', '"', "'", '<', '>', ')', ']', '}', ',', ';']) {
    const pos = text.indexOf(ch, start)
    if (pos !== -1 && pos < end) end = pos
  }
  return text.slice(start, end)
}

function passwordFromUrl(url: string): string {
  for (const param of ['pwd=', 'password=', 'passcode=', 'code=']) {
    const pos = url.indexOf(param)
    if (pos === -1) continue
    const start = pos + param.length
    let end = url.length
    for (let i = start; i < url.length; i++) {
      if (url[i] === '&' || url[i] === '#') {
        end = i
        break
      }
    }
    if (start < end) return url.slice(start, end)
  }
  return ''
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length

/** 夸克链接 + 就近（3 行内）的提取码，对应 Go extractQuarkLinksFromText。 */
function extractQuarkLinks(content: string): { url: string; type: string; password: string }[] {
  const lines = content.split('\n')
  const links: { url: string; type: string; password: string; pos: number }[] = []
  const pwds: { pos: number; password: string }[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line.includes('pan.quark.cn')) {
      const url = extractUrl(line)
      if (url) links.push({ url, type: 'quark', password: '', pos: i })
    }
    for (const kw of ['提取码', '密码']) {
      if (!line.includes(kw)) continue
      let colon = line.indexOf(':')
      if (colon === -1) colon = line.indexOf('：')
      if (colon !== -1 && colon + 1 < line.length) {
        const password = line.slice(colon + 1).trim()
        if (utf8Len(password) <= 10) pwds.push({ pos: i, password })
      }
    }
  })
  for (const l of links) {
    const inUrl = passwordFromUrl(l.url)
    if (inUrl) {
      l.password = inUrl
      continue
    }
    let min = 1000000
    let closest = ''
    for (const p of pwds) {
      const d = Math.abs(p.pos - l.pos)
      if (d < min) {
        min = d
        closest = p.password
      }
    }
    if (min <= 3) l.password = closest
  }
  return links.map(({ url, type, password }) => ({ url, type, password }))
}

export default definePlugin({
  name: 'quark4k',
  priority: 3,
  skipServiceFilter: true,
  async search(keyword, ctx) {
    // 原版第 2 页前的随机延迟与伪造 X-Forwarded-For 已删除：Workers 里无意义/会被覆盖
    const pages = await mapLimit(
      Array.from({ length: PAGE_COUNT }, (_, i) => i * PAGE_SIZE),
      PAGE_COUNT,
      (offset) =>
        fetchFlarumDiscussions(ctx, {
          base: BASE_URL,
          keyword,
          include: INCLUDE,
          limit: PAGE_SIZE,
          offset,
          extraParams: [['sort', '']],
          retries: 2,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            Referer: `${BASE_URL}/`,
          },
        }),
    )
    const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
    const seen = new Set<string>()
    const results: SearchResult[] = []
    for (const p of pages) {
      if (p.status === 'rejected') throw p.reason // 任一页失败即整体失败（与原版一致）
      for (const d of p.value) {
        const lt = d.title.toLowerCase()
        if (!kws.every((k) => lt.includes(k))) continue
        const content = cleanHtml(d.contentHtml)
        const links = extractQuarkLinks(content)
        if (links.length === 0) continue
        let datetime = parseTime(d.createdAt)
        if (datetime === ZERO_TIME) datetime = nowIso()
        const r = makeResult({ plugin: 'quark4k', id: d.id, title: d.title, content, datetime, links })
        if (seen.has(r.unique_id)) continue
        seen.add(r.unique_id)
        results.push(r)
      }
    }
    results.sort((a, b) => (a.datetime < b.datetime ? 1 : a.datetime > b.datetime ? -1 : 0))
    return filterByKeyword(results, keyword)
  },
})
