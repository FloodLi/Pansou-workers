# pansou-workers

[PanSou](https://github.com/fish2018/pansou) 网盘搜索 API 的 **Cloudflare Workers（TypeScript）精简移植版**。
请求与响应格式与原项目对齐，现有客户端/前端只需改域名即可使用。

> 本项目是原项目的非官方移植，插件解析逻辑移植自原项目（MIT）。移植范围与取舍见 [docs/](docs/)。

## 当前状态

| 能力 | 状态 |
|---|---|
| `GET/POST /api/search`、`GET /api/health` | 已实现 |
| TG 频道搜索 | 见 [任务清单](docs/implementation-plan.md#任务清单与进度) |
| 17 个插件（阶段 1） | 已移植，**fixture 为合成数据，尚未对真实站点验证**，上线前请先做在线检查 |
| 缓存（KV）+ 尽快响应/后台补全 | 已实现 |
| 静态 Token 认证（可选） | 已实现（见下方「访问控制」） |
| JWT 登录认证、链接有效性检测、其余 B/C/D 级插件 | 未做（见 [可移植性报告](docs/plugin-portability-report.md)） |

## API

与原项目一致：

```bash
# GET
curl 'https://<你的域名>/api/search?kw=流浪地球&res=merge&src=all'

# POST
curl -X POST 'https://<你的域名>/api/search' \
  -H 'Content-Type: application/json' \
  -d '{"kw":"流浪地球","channels":["tgsearchers7"],"plugins":["quarkres"],"res":"merge","src":"all","cloud_types":["quark","baidu"],"filter":{"include":["4k"],"exclude":["枪版"]}}'
```

| 参数 | 说明 |
|---|---|
| `kw` | 关键词（必填） |
| `channels` | TG 频道，逗号分隔；默认取 `CHANNELS` |
| `src` | `all`（默认）/ `tg` / `plugin` |
| `plugins` | 指定插件，逗号分隔；不指定则运行 `ENABLED_PLUGINS` 全部 |
| `res` | `merged_by_type`（默认，`merge` 等价）/ `results` / `all` |
| `cloud_types` | 只返回指定网盘类型 |
| `refresh` | `true` 时跳过缓存 |
| `ext` | 传给插件的扩展参数（JSON） |
| `filter` | `{"include":[],"exclude":[]}` 关键词过滤 |
| `conc` | 兼容保留，本版忽略 |

响应：`{"code":0,"message":"success","data":{"total":N,"results":[...],"merged_by_type":{...}}}`。

与原项目的差异：
- 缺少 `kw` 时 GET 也返回 400（原项目 GET 会执行空搜索）。
- 不支持 `/api/auth/*`（登录换 JWT）、`/api/check/links`；认证改为静态 Token，见下。
- 无时区的时间字符串一律按 **UTC** 解析，与原项目一致。
- 慢来源在响应之后由 `waitUntil` 继续，**第一次查询的结果可能不完整，再查一次会更全**（与原项目的异步插件行为一致）。

## 访问控制（静态 Token）

默认接口公开。设置 `API_TOKEN` 后，除 `/api/health` 外所有接口都需要带令牌，行为与原项目开启认证时一致：

```bash
# 设置（任选其一）
npx wrangler secret put API_TOKEN          # 手动
# 或在 GitHub 仓库 Secrets 里添加 API_TOKEN，部署时自动同步（见下方「部署」）

# 调用
curl -H 'Authorization: Bearer <API_TOKEN>' 'https://<你的域名>/api/search?kw=流浪地球'
```

未带或令牌错误返回 `401`，响应体为 `{"error":"…","code":"AUTH_TOKEN_MISSING|AUTH_TOKEN_INVALID_FORMAT|AUTH_TOKEN_INVALID"}`（与原项目一致）。令牌用恒定时间比较。`/api/health` 的 `auth_enabled` 字段会反映当前是否启用。

> 令牌放在请求头里，不要放进 URL。本地开发把 `API_TOKEN=xxx` 写进 `.dev.vars` 即可测试；`scripts/*.mjs` 通过环境变量 `API_TOKEN` 传入令牌。

## 配置

在 [wrangler.toml](wrangler.toml) 的 `[vars]` 中配置：

| 变量 | 默认 | 说明 |
|---|---|---|
| `CHANNELS` | `tgsearchers7` | 默认 TG 频道 |
| `ENABLED_PLUGINS` | 17 个阶段 1 插件 | 必须显式列出 |
| `ASYNC_RESPONSE_TIMEOUT` | `4` | 尽快响应窗口（秒） |
| `PLUGIN_TIMEOUT` | `25` | 单插件超时（秒），需小于 `waitUntil` 的 30 秒 |
| `SUBREQUEST_BUDGET` | `48` | 单次请求外部子请求（fetch）预算，免费版上限 50；KV 读写另算，不占此额度 |
| `MAX_TG_CHANNELS` | `1` | 单次请求最多搜索的 TG 频道数；单频道页面解析约 5~8ms CPU（本机实测），免费版建议保持 1 |
| `MAX_PAGES_YUNSOU` / `MAX_PAGES_CLDI` | `3` | 多页插件的页数上限 |
| `CACHE_TTL` / `CACHE_PARTIAL_TTL_MINUTES` | `60` / `3` | 完整/失败结果的缓存时长（分钟） |

## 免费版注意事项

本项目按 **Cloudflare Workers 免费版**设计：

- **外部子请求 50 次/请求**（KV 读写属于"Cloudflare 服务子请求"，免费版另有 1000 次上限，不占这 50 次）：用 `SUBREQUEST_BUDGET` 硬限制；17 个插件同时启用时典型约 31 次、最坏约 75 次，超出预算的来源会失败而不影响其他来源。
- **同时出站连接 6 个**：并发池上限 6。
- **KV 每天 1000 次写入**：每个查询只写 1 次（所有来源合并为一条）；命中缓存不写。
- **CPU 每次请求仅 10ms（网络等待不计）**：这是最大的风险。解析大页面（尤其 TG 页面）、合并排序、JSON 序列化都消耗 CPU。已选用 `node-html-parser` 并尽量用正则，但**未在真实流量下测过**。部署后请用 `npx wrangler tail` 或 Cloudflare 控制台观察 CPU 时间和 1102 错误；缓存命中的查询开销很小，未命中的查询可能超限。若频繁超限，需要升级到付费版（CPU 上限 30 秒起）或减少 `ENABLED_PLUGINS`。

## 本地开发

```bash
npm install
npm run check          # 类型检查 + 测试
cp .dev.vars.example .dev.vars
npm run dev            # http://127.0.0.1:8787
```

### 在线检查（会访问第三方站点，请自行确认）

fixture 是按 Go 解析逻辑手工构造的**合成数据**，不代表真实站点当前的页面。上线前请逐个核对：

```bash
npm run dev            # 需要 .dev.vars 里 DEBUG_ROUTES=true
node scripts/live-check.mjs --kw 流浪地球                 # 逐个检查插件：是否存活、是否疑似被拦
node scripts/capture-fixture.mjs quarkres 流浪地球        # 保存上游真实响应到 test/fixtures/quarkres/captured/
```

要看 **Cloudflare 出口**是否被目标站拦截，需要把 Worker 部署出去并临时设置 `DEBUG_ROUTES=true`，再用 `--base https://<你的>.workers.dev` 运行。**检查完请关掉 `DEBUG_ROUTES`。**

## 部署（GitHub Actions）

1. 在仓库 **Settings → Secrets and variables → Actions** 添加 Secrets：
   - `CLOUDFLARE_API_TOKEN`（权限：Workers Scripts:Edit、Workers KV Storage:Edit）
   - `CLOUDFLARE_ACCOUNT_ID`
   - `API_TOKEN`（可选；设置后接口需要 Bearer 令牌，不设置则公开）
2. **不需要创建 KV，也不需要配置任何 id**：[wrangler.toml](wrangler.toml) 里的 KV 绑定没写 `id`，首次 `wrangler deploy` 时 wrangler 会自动创建名为 `pansou-workers-cache` 的 KV 并绑定，之后每次部署自动沿用（需要 wrangler ≥ 4.45，本项目已满足；该功能为官方"自动资源配置"，属 beta）。
3. CI 与部署分开：[ci.yml](.github/workflows/ci.yml) 在推送到 `main` 和每个 PR 时自动跑类型检查与测试；[deploy.yml](.github/workflows/deploy.yml) **只能手动触发**——在仓库 **Actions → Deploy → Run workflow** 中运行，它会先重跑检查，通过后才发布。
   工作流使用 Node 26（当前 Active LTS，见 [.nvmrc](.nvmrc)）以及 `actions/checkout@v7`、`actions/setup-node@v7`、`cloudflare/wrangler-action@v4`（均为 Node 24 运行时）。
4. 部署后冒烟：`node scripts/smoke.mjs https://<你的>.workers.dev`

若要关闭自动创建、改用已有 KV，在 `wrangler.toml` 的 `[[kv_namespaces]]` 里补上 `id = "..."` 即可。未绑定 KV 时自动降级为进程内缓存（isolate 回收即丢失，仅适合本地开发）。

## 目录结构

```
src/
  index.ts            Hono 入口
  routes/             search / health / debug
  search/             合并、排序、按类型分组、过滤、编排（service.ts）
  cache/              KV 与内存缓存
  core/               http（预算/重试/超时）、并发池、时间、HTML
  links/              网盘链接识别、清洗、提取码
  tg/                 TG 频道搜索
  plugins/            17 个插件 + 共享 helper
test/                 vitest 单测与 fixtures
scripts/              live-check / capture-fixture / smoke
docs/                 可移植性报告、实现计划与进度
```

## 许可

[MIT](LICENSE)。移植自 [fish2018/pansou](https://github.com/fish2018/pansou)（MIT，Copyright (c) 2025 fish2018），已保留其版权声明。
