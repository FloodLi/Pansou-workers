import type { Context } from 'hono'
import { KvCache, MemoryCache } from '../cache/kv'
import type { ResultCache } from '../cache/types'
import { loadConfig } from '../config'
import { ALL_PLUGINS } from '../plugins'
import { applyResultFilter } from '../search/filter'
import { omitEmpty, search, type SearchParams } from '../search/service'
import { failure, success, type Env, type FilterConfig, type SearchRequest } from '../types'

/** 请求体大小上限，对应原项目 maxSearchRequestBodyBytes。 */
const MAX_BODY_BYTES = 1 << 20
/** 请求可指定的频道数上限，对应原项目 maxRequestChannels。实际搜索数由 MAX_TG_CHANNELS 再限制。 */
const MAX_REQUEST_CHANNELS = 512

const memoryCache = new MemoryCache()

export function cacheFor(env: Env): ResultCache {
  return env.CACHE ? new KvCache(env.CACHE) : memoryCache
}

function splitList(v: string | undefined): string[] {
  if (!v || !v.trim()) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

class BadRequest extends Error {}

function parseJsonParam<T>(raw: string | undefined, label: string): T | undefined {
  if (!raw || raw === ' ') return undefined
  try {
    return JSON.parse(raw) as T
  } catch (e) {
    throw new BadRequest(`无效的${label}参数格式: ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function readRequest(c: Context<{ Bindings: Env }>): Promise<SearchRequest> {
  if (c.req.method === 'GET') {
    const q = (k: string) => c.req.query(k)
    const conc = Number(q('conc'))
    return {
      kw: q('kw') ?? '',
      channels: splitList(q('channels')),
      conc: Number.isFinite(conc) ? conc : 0,
      refresh: q('refresh') === 'true',
      res: q('res') ?? '',
      src: q('src') ?? '',
      plugins: c.req.query('plugins') !== undefined ? splitList(q('plugins')) : undefined,
      cloud_types: c.req.query('cloud_types') !== undefined ? splitList(q('cloud_types')) : undefined,
      ext: parseJsonParam<Record<string, unknown>>(q('ext'), 'ext'),
      filter: parseJsonParam<FilterConfig>(q('filter'), 'filter'),
    }
  }
  const declared = Number(c.req.header('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw Object.assign(new BadRequest(`请求体过大（上限 ${MAX_BODY_BYTES} 字节）`), { status: 413 })
  const text = await c.req.text()
  if (text.length > MAX_BODY_BYTES) throw Object.assign(new BadRequest(`请求体过大（上限 ${MAX_BODY_BYTES} 字节）`), { status: 413 })
  try {
    const body = JSON.parse(text) as SearchRequest
    if (typeof body !== 'object' || body === null) throw new Error('请求体必须是 JSON 对象')
    if (typeof body.kw !== 'string' || body.kw === '') throw new Error("Key: 'SearchRequest.Keyword' Error:Field validation for 'Keyword' failed on the 'required' tag")
    return body
  } catch (e) {
    throw new BadRequest(`无效的请求参数: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function searchHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  let req: SearchRequest
  try {
    req = await readRequest(c)
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400
    return c.json(failure(status, (e as Error).message), status as 400)
  }
  if (!req.kw) return c.json(failure(400, '关键词(kw)不能为空'), 400)
  if ((req.channels?.length ?? 0) > MAX_REQUEST_CHANNELS) {
    return c.json(failure(400, `channels 数量 ${req.channels?.length} 超过上限 ${MAX_REQUEST_CHANNELS}`), 400)
  }

  const config = loadConfig(c.env)

  // 与原项目 handler 一致的默认值与参数互斥逻辑
  let resultType = req.res ?? ''
  if (resultType === '') resultType = 'merged_by_type'
  else if (resultType === 'merge') resultType = 'merged_by_type'
  const sourceType = req.src || 'all'
  let channels = req.channels ?? []
  let plugins = req.plugins ?? []
  if (channels.length === 0) channels = config.defaultChannels
  if (sourceType === 'tg') plugins = []
  else if (sourceType === 'plugin') channels = []

  const params: SearchParams = {
    keyword: req.kw,
    channels,
    forceRefresh: req.refresh === true,
    resultType,
    sourceType,
    plugins,
    cloudTypes: req.cloud_types,
    ext: req.ext ?? {},
  }

  try {
    const outcome = await search(params, { config, plugins: ALL_PLUGINS, cache: cacheFor(c.env) })
    let background = outcome.background
    try {
      c.executionCtx.waitUntil(background)
    } catch {
      // 没有 ExecutionContext（如单测）时直接等待，保证行为可预测
      await background
      background = Promise.resolve()
    }
    const filtered = req.filter ? omitEmpty(applyResultFilter(outcome.response, req.filter, resultType)) : outcome.response
    return c.json(success(filtered))
  } catch (e) {
    return c.json(failure(500, `搜索失败: ${e instanceof Error ? e.message : String(e)}`), 500)
  }
}
