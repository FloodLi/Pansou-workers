import type { SearchResult } from '../types'
import { parseTime } from '../core/time'
import { definePlugin, makeResult } from './types'

// 热门夸克资源：直连 squark.cc.cd 的聚合接口，上游只含夸克链接
const API_BASE = 'https://squark.cc.cd/api/search?kw='
const REFERER = 'https://squark.cc.cd/'
const NAME = 'quarkres'

interface ApiLink {
  type?: string
  url?: string
  password?: string
}

interface ApiItem {
  unique_id?: string
  title?: string
  content?: string
  datetime?: string
  links?: ApiLink[] | null
}

interface ApiResp {
  code?: number
  message?: string
  data?: ApiItem[] | null
}

export default definePlugin({
  name: NAME,
  priority: 2,
  skipServiceFilter: false,
  async search(keyword, ctx) {
    // 去掉随机延迟/缓存；Go 版无重试，保持单次请求
    const resp = await ctx.http.json<ApiResp>(API_BASE + encodeURIComponent(keyword), {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: REFERER,
      },
      retries: 0,
    })
    if (resp.code !== 200) throw new Error(`[${NAME}] API error: ${resp.message ?? ''}`)

    const out: SearchResult[] = []
    for (const item of resp.data ?? []) {
      const datetime = parseTime(item.datetime)
      // 只保留夸克链接（本源只有夸克）
      const links = (item.links ?? [])
        .filter((l) => (l.url ?? '').includes('pan.quark.cn'))
        .map((l) => ({ type: 'quark', url: l.url as string, password: l.password ?? '', datetime }))
      if (links.length === 0) continue
      out.push(
        makeResult({
          plugin: NAME,
          id: (item.unique_id ?? '').replace(new RegExp(`^${NAME}-`), ''),
          title: item.title ?? '',
          content: item.content ?? '',
          datetime,
          links,
        }),
      )
    }
    return out
  },
})
