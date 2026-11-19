import type { PluginContext } from '../types'

// dyyj 与 quark4k 共用的 Flarum 论坛解析：GET /api/discussions，再从 included 里的帖子取 contentHtml。

export interface FlarumDiscussion {
  id: string
  title: string
  createdAt: string
  /** mostRelevantPost 的 contentHtml */
  contentHtml: string
}

export interface FlarumQuery {
  /** 论坛根地址，不带结尾斜杠 */
  base: string
  keyword: string
  /** include 参数值，两站不同 */
  include: string
  limit: number
  offset?: number
  /** 其他需要原样附加的查询参数 */
  extraParams?: [string, string][]
  headers?: Record<string, string>
  /** 额外重试次数（每次尝试都扣预算） */
  retries?: number
}

interface FlarumResponse {
  data?: {
    id?: string
    attributes?: { title?: string; createdAt?: string }
    relationships?: { mostRelevantPost?: { data?: { id?: string } | null } }
  }[]
  included?: { type?: string; id?: string; attributes?: { contentHtml?: string } }[]
}

export function buildFlarumUrl(q: FlarumQuery): string {
  const p = new URLSearchParams()
  p.set('filter[q]', q.keyword)
  p.set('include', q.include)
  for (const [k, v] of q.extraParams ?? []) p.set(k, v)
  if (q.offset !== undefined) p.set('page[offset]', String(q.offset))
  p.set('page[limit]', String(q.limit))
  return `${q.base}/api/discussions?${p.toString()}`
}

/** 请求一页讨论并把帖子内容并入；找不到 mostRelevantPost 的讨论被丢弃（与原项目一致）。 */
export async function fetchFlarumDiscussions(ctx: PluginContext, q: FlarumQuery): Promise<FlarumDiscussion[]> {
  const payload = await ctx.http.json<FlarumResponse>(buildFlarumUrl(q), {
    headers: q.headers,
    retries: q.retries,
  })
  const posts = new Map<string, string>()
  for (const inc of payload.included ?? []) {
    // included 里还有 users/tags，id 可能与帖子撞号，只收 posts
    if (inc.type === 'posts' && inc.id !== undefined) posts.set(String(inc.id), inc.attributes?.contentHtml ?? '')
  }
  const out: FlarumDiscussion[] = []
  for (const d of payload.data ?? []) {
    const postId = d.relationships?.mostRelevantPost?.data?.id
    if (postId === undefined || !posts.has(String(postId))) continue
    out.push({
      id: String(d.id ?? ''),
      title: d.attributes?.title ?? '',
      createdAt: d.attributes?.createdAt ?? '',
      contentHtml: posts.get(String(postId)) ?? '',
    })
  }
  return out
}

/** 等价于原项目 FilterResultsByKeyword：每个关键词须出现在标题或内容里（不区分大小写）。 */
export function filterByKeyword<T extends { title: string; content?: string }>(items: T[], keyword: string): T[] {
  const kws = keyword.toLowerCase().split(/\s+/).filter(Boolean)
  if (kws.length === 0) return items
  return items.filter((r) => {
    const t = r.title.toLowerCase()
    const c = (r.content ?? '').toLowerCase()
    return kws.every((k) => t.includes(k) || c.includes(k))
  })
}

/** 当前时间的 RFC3339（秒精度），对应 Go 里解析失败时的 time.Now()。 */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}
