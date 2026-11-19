#!/usr/bin/env node
// 在线检查：逐个调用调试路由，验证目标站是否存活、是否拦截当前出口。
// 注意：这会向第三方站点发真实请求，请自行确认可以访问；默认串行并带间隔。
//
// 用法：
//   cp .dev.vars.example .dev.vars && npx wrangler dev        # 本机出口
//   node scripts/live-check.mjs --kw 流浪地球 [插件名...]
//   node scripts/live-check.mjs --base https://<你的>.workers.dev --kw 流浪地球   # Cloudflare 出口（需部署时设置 DEBUG_ROUTES=true）

const args = process.argv.slice(2)
const opt = { base: 'http://127.0.0.1:8787', kw: '', delay: 1500 }
const names = []
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--base') opt.base = args[++i]
  else if (a === '--kw') opt.kw = args[++i]
  else if (a === '--delay') opt.delay = Number(args[++i])
  else names.push(a)
}
if (!opt.kw) {
  console.error('缺少 --kw <关键词>')
  process.exit(2)
}
// 服务端设置了 API_TOKEN 时，通过环境变量传入：API_TOKEN=xxx node scripts/live-check.mjs ...
const authHeaders = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let targets = names
if (targets.length === 0) {
  const health = await (await fetch(`${opt.base}/api/health`, { headers: authHeaders })).json()
  targets = health.plugins ?? []
}

const rows = []
for (const name of targets) {
  const url = `${opt.base}/api/_debug/plugin/${encodeURIComponent(name)}?kw=${encodeURIComponent(opt.kw)}`
  try {
    const res = await fetch(url, { headers: authHeaders })
    const body = await res.json()
    if (res.status !== 200 || body.plugin === undefined) {
      rows.push({ plugin: name, 状态: `HTTP ${res.status}`, 说明: body.message ?? '' })
    } else {
      const statuses = [...new Set(body.requests.map((r) => r.status))].join('/')
      rows.push({
        plugin: name,
        状态: body.ok ? (body.count > 0 ? 'OK' : '无结果') : '失败',
        结果数: body.count,
        链接数: body.linkCount,
        耗时ms: body.elapsedMs,
        子请求: body.subrequests,
        上游状态: statuses,
        疑似挑战: body.challengeSuspected ? '是' : '',
        说明: body.error ?? '',
      })
    }
  } catch (e) {
    rows.push({ plugin: name, 状态: '请求失败', 说明: String(e) })
  }
  await sleep(opt.delay)
}
console.table(rows)
const bad = rows.filter((r) => r.状态 !== 'OK')
console.log(`\n共 ${rows.length} 个，正常 ${rows.length - bad.length} 个，异常 ${bad.length} 个：${bad.map((r) => r.plugin).join(', ')}`)
