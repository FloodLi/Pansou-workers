import { describe, expect, it } from 'vitest'
import app from '../../src/index'
import type { Env } from '../../src/types'

const env: Env = { API_TOKEN: 's3cret-token', ENABLED_PLUGINS: 'quarkres', DEBUG_ROUTES: 'true' }
const call = (path: string, headers: Record<string, string> = {}, e: Env = env) => app.request(path, { headers }, e)
const search = '/api/search?kw=abc&src=plugin&plugins=none'

describe('静态 Token 认证', () => {
  it('未设置 API_TOKEN 时全部放行，health 报告 auth_enabled=false', async () => {
    const open: Env = { ENABLED_PLUGINS: 'quarkres' }
    expect((await call(search, {}, open)).status).toBe(200)
    expect(((await (await call('/api/health', {}, open)).json()) as { auth_enabled: boolean }).auth_enabled).toBe(false)
  })

  it('/api/health 保持公开，并报告 auth_enabled=true', async () => {
    const res = await call('/api/health')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { auth_enabled: boolean }).auth_enabled).toBe(true)
  })

  it('缺少令牌 → 401 AUTH_TOKEN_MISSING（响应体与原项目一致）', async () => {
    const res = await call(search)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: '未授权：缺少认证令牌', code: 'AUTH_TOKEN_MISSING' })
    expect(res.headers.get('www-authenticate')).toBe('Bearer')
  })

  it('格式错误 → 401 AUTH_TOKEN_INVALID_FORMAT', async () => {
    const res = await call(search, { Authorization: 's3cret-token' })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('AUTH_TOKEN_INVALID_FORMAT')
    const basic = await call(search, { Authorization: 'Basic s3cret-token' })
    expect(((await basic.json()) as { code: string }).code).toBe('AUTH_TOKEN_INVALID_FORMAT')
  })

  it('令牌错误（含前缀相同、长度不同、大小写不同）→ 401 AUTH_TOKEN_INVALID', async () => {
    for (const bad of ['wrong', 's3cret-token-x', 's3cret-toke', 'S3CRET-TOKEN']) {
      const res = await call(search, { Authorization: `Bearer ${bad}` })
      expect(res.status, bad).toBe(401)
      expect(((await res.json()) as { code: string }).code, bad).toBe('AUTH_TOKEN_INVALID')
    }
  })

  it('令牌正确 → 放行（GET 与 POST）', async () => {
    const auth = { Authorization: 'Bearer s3cret-token' }
    const get = await call(search, auth)
    expect(get.status).toBe(200)
    const post = await app.request('/api/search', { method: 'POST', headers: auth, body: JSON.stringify({ kw: 'abc', src: 'plugin', plugins: ['none'] }) }, env)
    expect(post.status).toBe(200)
  })

  it('调试路由同样受保护', async () => {
    expect((await call('/api/_debug/plugin/quarkres?kw=a')).status).toBe(401)
  })

  it('CORS 预检请求不需要令牌', async () => {
    const res = await app.request('/api/search', { method: 'OPTIONS', headers: { Origin: 'https://x.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } }, env)
    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('未知路径在认证开启时也先要求令牌（不泄露路由存在性）', async () => {
    expect((await call('/api/nope')).status).toBe(401)
  })
})
