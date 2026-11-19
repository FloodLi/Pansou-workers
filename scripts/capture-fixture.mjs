#!/usr/bin/env node
// 抓取 fixture：调用调试路由并把上游原始响应保存到 test/fixtures/<插件>/captured/。
// 注意：这会向第三方站点发真实请求，请自行确认可以访问。
//
// 用法：
//   cp .dev.vars.example .dev.vars && npx wrangler dev
//   node scripts/capture-fixture.mjs <插件名> <关键词> [--base http://127.0.0.1:8787]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
let base = 'http://127.0.0.1:8787'
const pos = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i]
  else pos.push(args[i])
}
const [name, kw] = pos
if (!name || !kw) {
  console.error('用法: node scripts/capture-fixture.mjs <插件名> <关键词> [--base URL]')
  process.exit(2)
}

// 服务端设置了 API_TOKEN 时，通过环境变量传入：API_TOKEN=xxx node scripts/capture-fixture.mjs ...
const authHeaders = process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}
const res = await fetch(`${base}/api/_debug/plugin/${encodeURIComponent(name)}?kw=${encodeURIComponent(kw)}&capture=1`, { headers: authHeaders })
const body = await res.json()
if (res.status !== 200 || !body.requests) {
  console.error('失败:', res.status, body.message ?? body)
  process.exit(1)
}
const dir = join('test', 'fixtures', name, 'captured')
mkdirSync(dir, { recursive: true })
body.requests.forEach((r, i) => {
  const ext = r.contentType.includes('json') ? 'json' : 'html'
  const file = join(dir, `${i + 1}-${r.method}-${r.status}.${ext}`)
  writeFileSync(file, r.body)
  console.log(`${r.method} ${r.url} -> ${r.status}${r.challenge ? ' [疑似挑战页]' : ''}${r.truncated ? ' [已截断]' : ''}  => ${file}`)
})
writeFileSync(
  join(dir, 'meta.json'),
  JSON.stringify({ plugin: name, kw, capturedAt: new Date().toISOString(), ok: body.ok, error: body.error, requests: body.requests.map(({ body: _b, ...m }) => m) }, null, 2),
)
console.log(`\n完成：${body.requests.length} 个响应。结果数=${body.count}，ok=${body.ok}${body.error ? '，错误=' + body.error : ''}`)
console.log('提示：保存前请检查内容，不要提交含个人信息的响应。')
