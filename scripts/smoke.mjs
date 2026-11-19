#!/usr/bin/env node
// 冒烟：对已部署（或本地）的 Worker 发起 health / tg / plugin / all 四类请求，校验响应结构。
// 用法：node scripts/smoke.mjs https://<你的>.workers.dev [关键词]
const base = process.argv[2]
const kw = process.argv[3] ?? '流浪地球'
if (!base) {
  console.error('用法: node scripts/smoke.mjs <base-url> [kw]')
  process.exit(2)
}
// 服务端设置了 API_TOKEN 时，通过环境变量传入：API_TOKEN=xxx node scripts/smoke.mjs ...
const authHeaders = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}
let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}

const health = await (await fetch(`${base}/api/health`)).json() // health 始终公开
check('health', health.status === 'ok', `plugins=${health.plugin_count} cache=${health.cache}`)

for (const src of ['tg', 'plugin', 'all']) {
  const t0 = Date.now()
  const res = await fetch(`${base}/api/search?kw=${encodeURIComponent(kw)}&src=${src}&res=all`, { headers: authHeaders })
  const body = await res.json().catch(() => null)
  const ok = res.status === 200 && body?.code === 0 && typeof body.data?.total === 'number'
  check(`search src=${src}`, ok, `${Date.now() - t0}ms total=${body?.data?.total}`)
}

const bad = await fetch(`${base}/api/search`, { headers: authHeaders })
check('缺少 kw 返回 400', bad.status === 400)
if (health.auth_enabled) {
  const noAuth = await fetch(`${base}/api/search?kw=x`)
  check('未带令牌返回 401', noAuth.status === 401)
}
process.exit(failed ? 1 : 0)
