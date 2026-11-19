import { describe, expect, it } from 'vitest'
import app from '../../src/index'
import type { Env } from '../../src/types'

const env: Env = {
  ENABLED_PLUGINS: 'quarkres',
  ASYNC_RESPONSE_TIMEOUT: '1',
  SUBREQUEST_BUDGET: '20',
}

const call = (path: string, init?: RequestInit) => app.request(path, init, env)

describe('API', () => {
  it('health', async () => {
    const res = await call('/api/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ status: 'ok', plugins_enabled: true, plugins: ['quarkres'], channels: ['tgsearchers7'] })
  })

  it('GET 缺少 kw 返回 400', async () => {
    const res = await call('/api/search')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: number }).code).toBe(400)
  })

  it('非法 ext / filter 返回 400 与原项目一致的提示', async () => {
    const a = await call('/api/search?kw=a&ext={bad')
    expect(a.status).toBe(400)
    expect(((await a.json()) as { message: string }).message).toContain('无效的ext参数格式')
    const b = await call('/api/search?kw=a&filter=[')
    expect(((await b.json()) as { message: string }).message).toContain('无效的filter参数格式')
  })

  it('POST 缺少 kw / 非 JSON 返回 400', async () => {
    const a = await call('/api/search', { method: 'POST', body: '{}' })
    expect(a.status).toBe(400)
    const b = await call('/api/search', { method: 'POST', body: 'nope' })
    expect(((await b.json()) as { message: string }).message).toContain('无效的请求参数')
  })

  it('src=tg + plugins 被忽略；无来源时返回空结果且结构正确', async () => {
    // 不让它访问网络：src=plugin 且指定一个不存在的插件 → 无任何来源
    const res = await call('/api/search?kw=abc&src=plugin&plugins=nonexistent')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { code: number; message: string; data: { total: number } }
    expect(body).toMatchObject({ code: 0, message: 'success', data: { total: 0 } })
  })

  it('POST 与 GET 参数等价', async () => {
    const get = await call('/api/search?kw=abc&src=plugin&plugins=nonexistent&res=merge')
    const post = await call('/api/search', { method: 'POST', body: JSON.stringify({ kw: 'abc', src: 'plugin', plugins: ['nonexistent'], res: 'merge' }) })
    expect(await post.json()).toEqual(await get.json())
  })

  it('404 使用统一错误结构', async () => {
    const res = await call('/nope')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: number }).code).toBe(404)
  })

  it('CORS 头', async () => {
    const res = await call('/api/health', { headers: { Origin: 'https://example.com' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
