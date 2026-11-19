import type { MiddlewareHandler } from 'hono'
import type { Env } from './types'

/** 与原项目 AuthMiddleware 一致：认证开启时，除这些路径外都需要 Bearer 令牌。 */
const PUBLIC_PATHS = ['/api/health']

/** 恒定时间比较：先各自取 SHA-256 摘要（长度固定），再逐字节异或累积，避免按长度/前缀泄露信息。 */
async function tokenEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const x = new Uint8Array(da)
  const y = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= (x[i] as number) ^ (y[i] as number)
  return diff === 0
}

function unauthorized(error: string, code: string): Response {
  // 响应体与原项目 401 一致：{error, code}
  return new Response(JSON.stringify({ error, code }), {
    status: 401,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'www-authenticate': 'Bearer' },
  })
}

/**
 * 静态令牌认证。设置了 `API_TOKEN`（建议用 `wrangler secret put API_TOKEN`）才启用；
 * 未设置则全部放行（与原项目 AUTH_ENABLED=false 一致）。
 * 客户端：`Authorization: Bearer <API_TOKEN>`。
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const expected = c.env.API_TOKEN
  if (!expected) return next()
  if (PUBLIC_PATHS.some((p) => c.req.path.startsWith(p))) return next()

  const header = c.req.header('Authorization')
  if (!header) return unauthorized('未授权：缺少认证令牌', 'AUTH_TOKEN_MISSING')
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return unauthorized('未授权：令牌格式错误', 'AUTH_TOKEN_INVALID_FORMAT')
  if (!(await tokenEquals(header.slice(prefix.length), expected))) {
    return unauthorized('未授权：令牌无效', 'AUTH_TOKEN_INVALID')
  }
  return next()
}
