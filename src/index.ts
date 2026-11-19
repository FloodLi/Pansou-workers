import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { authMiddleware } from './auth'
import { debugPluginHandler } from './routes/debug'
import { healthHandler } from './routes/health'
import { searchHandler } from './routes/search'
import type { Env } from './types'
import { failure } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())
// 设置了 API_TOKEN 才启用；放在 CORS 之后，预检请求不受影响
app.use('/api/*', authMiddleware)

app.get('/api/health', healthHandler)
app.on(['GET', 'POST'], '/api/search', searchHandler)
// 仅 DEBUG_ROUTES=true 时生效，用于上线前的在线检查（见 scripts/live-check.mjs）
app.get('/api/_debug/plugin/:name', debugPluginHandler)

app.notFound((c) => c.json(failure(404, '接口不存在'), 404))
app.onError((err, c) => c.json(failure(500, `服务器错误: ${err.message}`), 500))

export default app
