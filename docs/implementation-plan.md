# PanSou Workers 版实现计划：阶段 0（骨架）+ 阶段 1（17 个 A 级插件）

> 依据：[plugin-portability-report.md](plugin-portability-report.md) 与原项目 [fish2018/pansou](https://github.com/fish2018/pansou) 源码（`api/`、`service/search_service.go`、`util/parser_util.go`、`util/regex_util.go`、`plugin/*`）。
> 工作量为粗估（单人，含单测），不含联调等待。

## 任务清单与进度

> 最后更新：代码实现完成后。**测试：33 个文件、274 个用例全部通过、0 跳过；`tsc --noEmit` 无错误；`wrangler deploy --dry-run` 打包成功（408 KiB，gzip 后 115 KiB，免费版上限 3 MiB）；`wrangler dev` 在 workerd 中启动并通过本地冒烟。**
> 图例：`[x]` 代码与测试已完成；`[ ]` 未完成。**所有插件与 TG 的 fixture 除 TG 两份页面外均为合成数据，未对真实站点验证**，见下方"待线上验证"。

### 阶段 0：骨架

- [x] **T0.1 项目脚手架** — Hono + wrangler + TypeScript strict + vitest；按 GitHub 惯例组织（`src/`、`test/`、`scripts/`、`docs/`、`.github/workflows/`、`README.md`、`LICENSE`）。*偏差*：未引入 eslint/prettier，仅用 `.editorconfig` + `tsc`。
- [x] **T0.2 类型与 API 契约** — `src/types.ts`；`test/types.test.ts` 锁定字段名/顺序/`omitempty` 行为（含无结果时只返回 `{"total":0}`，与 Go 一致）。
- [x] **T0.3 核心工具** — `core/{http,pool,budget,html,time}.ts`；预算、重试（每次尝试都扣预算）、体积上限、`mapLimit`（上限 6）均有测试。*决定变更*：HTML 解析库由 `cheerio` 改为 **`node-html-parser`**（免费版 CPU 仅 10ms，后者更快）；未做 `linkedom` 对比。
- [x] **T0.4 链接识别/清洗/提取码** — `src/links/*`，37 个用例（转写自 Go 测试）；已知与 Go 行为差异见代码注释与 `test/links`。
- [x] **T0.5 插件框架** — `plugins/{types,run,registry,index}.ts`；`test/plugins/run.test.ts`（超时/异常隔离/预算耗尽/规范化）、`registry.test.ts`（17 个插件的 name/priority/skipServiceFilter 与 Go 版核对、与 `wrangler.toml` 一致）。
- [x] **T0.6 TG 频道搜索** — `src/tg/{parse,search}.ts`；Go 的 TG 解析用例**全部转写**（含两份真实抓取页面，断言数值一致）。*取舍*：Go 实际只抓首页，故 `TG_MAX_PAGES=1`，与原行为等价；`MAX_TG_CHANNELS` 默认 1。**CPU 风险**：本机实测解析 138KB≈5ms、162KB≈8ms。
- [x] **T0.7 搜索服务** — `search/{merge,rank,mergeByType,filter,titles,service}.ts`；排序/合并/过滤/按类型分组的规则与 Go 对齐，22 个用例。
- [x] **T0.8 HTTP API** — `GET/POST /api/search`、`GET /api/health`、CORS、统一错误结构。*偏差*：GET 缺少 `kw` 返回 400（原项目会执行空搜索）；`conc` 参数兼容但忽略。
- [x] **T0.9 缓存与"尽快响应、持续补全"** — 一次查询一条 KV（读 1 次、写 1 次），来源分条存放；新鲜来源不再出站；慢来源由 `waitUntil` 补全；失败标记短 TTL；过期缓存兜底。*已核实*：免费版 KV 操作属于"Cloudflare 服务子请求"（上限 1000，**不占** 50 次外部子请求）——据 Cloudflare 官方文档的检索摘要，未逐页核对原文。
- [x] **T0.10 部署与冒烟** — `.github/workflows/{ci,deploy}.yml`、`scripts/smoke.mjs`、README 部署说明。**尚未真实部署**（需要你配置 secrets/variables，见下）。

### 追加变更（第二轮）

- [x] **时间策略改为 UTC**：`parseTime` 对无时区时间一律按 UTC 解析，与原项目一致；7 个插件测试的期望值相应更新（+8 小时）。
- [x] **静态 Token 认证**：`src/auth.ts`（`API_TOKEN` secret，`Authorization: Bearer`，恒定时间比较，401 响应体与原项目一致，`/api/health` 公开）；`test/api/auth.test.ts` 9 个用例；`scripts/*.mjs` 支持 `API_TOKEN` 环境变量；`deploy.yml` 把 GitHub Secret `API_TOKEN` 同步为 Worker secret。
- [x] **`wrangler.jsonc` → `wrangler.toml`**：`wrangler deploy --dry-run` 通过；`wrangler dev`（含 `--var API_TOKEN`）在 workerd 中验证通过。
- [x] **KV 自动创建并绑定**：绑定里不写 `id`，移除了 `KV_NAMESPACE_ID` 变量与 `deploy.yml` 里的 sed 步骤。

- [x] **工作流升级与手动部署**：Node 22 → **26**（Active LTS）；`checkout@v7`、`setup-node@v7`、`wrangler-action@v4`（均 Node 24 运行时，标签已核对存在）；`deploy.yml` 改为仅 `workflow_dispatch`；`package.json` 的 `engines` 与 wrangler 对齐为 `>=22.12.0`；在 Node 26.13.1 下重跑 274 个测试与类型检查均通过。

### 阶段 1：17 个 A 级插件

- [x] **T1.0 测试与在线检查工具** — `test/helpers/{mockFetch,assertions}.ts`；调试路由 `GET /api/_debug/plugin/:name`（仅 `DEBUG_ROUTES=true`，默认 404）；`scripts/{live-check,capture-fixture}.mjs`。
- [x] **T1.1 MacCMS 类** — wanou、ouge（共享 `_helpers/maccms.ts`）
- [x] **T1.2 简单 JSON 接口类** — quarkres、ikantv、meitizy、melost
- [x] **T1.3 Flarum 类** — dyyj（已删除 HTML 详情页回退）、quark4k（共享 `_helpers/flarum.ts`）
- [x] **T1.4 磁力/种子类** — nyaa、cldi（页数取 `MAX_PAGES_CLDI`）、feikuai（md5 → 同步哈希）
- [x] **T1.5 内嵌数据 HTML** — haitunsou、zlxapp（共享 `_helpers/jsLiteral.ts`）
- [x] **T1.6 编码与多页类** — quarksoo、yunsou（页数取 `MAX_PAGES_YUNSOU`）、yunso（XOR+base64）、xiaokupan（`_helpers/seroval.ts`，函数 ID 失效自动重新发现）
- [x] **T1.7 注册、集成与预算核算** — 17 个插件已注册；`test/integration/e2e.test.ts`（TG + 插件 + 缓存 + 单来源失败隔离）。预算核算见第 7 节。

### 待线上验证与后续事项（均未完成）

- [ ] **首次真实部署**：配置仓库 Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，可选 `API_TOKEN`）；在 Actions 页面手动运行 Deploy 工作流（KV 由 wrangler 自动创建并绑定，无需 id）；运行 `scripts/smoke.mjs`。**KV 自动创建在 CI 中是否按预期工作，只验证了配置能通过 `--dry-run`，未用真实账号验证。**
- [ ] **在线检查**（由你手动执行，会访问第三方站点）：用 `scripts/live-check.mjs` 对 17 个插件 + `t.me/s/` 先在本机出口、再在 Cloudflare 出口检查存活与拦截情况；按结果从 `ENABLED_PLUGINS` 移除失效插件，并更新可移植性报告。
- [ ] **用真实响应替换合成 fixture**：`scripts/capture-fixture.mjs` 抓取后补回归测试（优先 xiaokupan、yunso、nyaa、melost、haitunsou、zlxapp——它们的解析最依赖页面真实结构）。
- [ ] **实测 CPU 耗时**（免费版每请求 10ms，最大风险）：部署后用 `wrangler tail` / 控制台观察，关注 Error 1102。若 TG 解析超限：改为只截取消息块再解析、减少 `MAX_TG_CHANNELS`，或升级付费版。
- [ ] 抽取多处重复的 `filterByKeyword` 到共享 helper（目前 `_helpers/text.ts`、`_helpers/flarum.ts` 与若干插件内联各有一份）。
- [ ] 真实 Workers 环境下验证 `waitUntil` 补全与 KV 写入（本地仅单测与 `wrangler dev` 启动验证）。
- [ ] 未纳入本期：JWT 登录认证（已用静态 Token 替代）、`/api/check/links`、B/C/D 级插件、前端。

## 0. 范围

**包含**
- 阶段 0：Workers 项目骨架、与原项目对齐的 `/api/search`（GET/POST）与 `/api/health`、TG 频道搜索、链接识别/清洗、搜索合并/排序/过滤、缓存与"尽快响应、持续补全"。
- 阶段 1：已在 `main.go` 注册的 17 个 A 级插件：haitunsou、quarkres、ouge、wanou、dyyj、ikantv、meitizy、melost、nyaa、quarksoo、zlxapp、feikuai、xiaokupan、quark4k、yunso、yunsou、cldi。

**不包含（后续再议）**
- JWT 认证（`/api/auth/*`）、`/api/check/links` 链接有效性检测、前端页面
- B/C/D 级插件
- SOCKS5/HTTP 代理（Workers 无此能力）

## 1. 目标与验收（Definition of Done）

1. `GET/POST /api/search` 的**请求参数与响应结构与原项目一致**：`kw`、`channels`、`conc`、`refresh`、`res`、`src`、`plugins`、`cloud_types`、`ext`、`filter`；响应外层 `{code, message, data:{total, results?, merged_by_type?}}`。现有客户端与前端应能只改域名使用。
2. TG 频道搜索与 17 个插件均可通过 `src=tg|plugin|all`、`plugins=a,b` 单独选择。
3. 搜索在 `ASYNC_RESPONSE_TIMEOUT`（默认 4 秒）内返回已有结果；未完成的插件由 `ctx.waitUntil` 继续跑并写入缓存，下一次相同查询命中更完整的结果。
4. 单次请求的外部子请求数有**硬上限**（`SUBREQUEST_BUDGET`，**默认按免费版 48**），不会因插件扇出而被平台终止。
5. 每个插件有单测（fixture 回放），且有一个**手动触发的在线检查脚本**，用来验证站点存活和 Cloudflare 出口是否被拦。
6. 部署到 staging（`workers.dev`），冒烟脚本通过。

## 2. 关键设计决定

| 议题 | 决定 | 理由 / 备注 |
|---|---|---|
| 框架 | Hono + wrangler + TypeScript（strict） | 路由、CORS、中间件够用，体积小 |
| HTML 解析 | **`node-html-parser`**（已定稿，原计划为 cheerio） | 免费版每请求 CPU 仅 10ms，它比基于 parse5 的 cheerio 快数倍；只支持常用 CSS 选择器，复杂场景改用正则；与 goquery 的 `.Text()` 行为有差异（见 `src/tg/parse.ts`） |
| 测试 | `vitest` + 手写 `fetch` mock；fixture 放 `test/fixtures/<plugin>/` | 不依赖 Workers 运行时即可跑，速度快 |
| 缓存 | 抽象 `ResultCache` 接口，默认 KV 实现；**一次查询一条 KV 值，内部按来源（`tg:<channel>` / `plugin:<name>`）分条存放** | 免费版 KV 每天仅 1000 次写入，所以每个未命中的查询只写 1 次、命中不写；分来源存放让慢插件结果在下次查询里逐步补全 |
| 异步补全 | 先并发启动全部来源 → `Promise.race(全部完成, 超时)` → 返回已完成部分 → 其余交给 `ctx.waitUntil` | 对应原框架"尽快响应，持续处理" |
| 子请求预算 | 一个请求级别的 `SubrequestBudget`，所有 `fetch` 与缓存读写都经它计数 | 防止扇出爆限制 |
| 并发 | 全局出站并发上限 6（`mapLimit`） | Workers 同一调用同时出站连接最多 6 个 |
| 时间格式 | 输出 RFC3339；缺失时间输出 `0001-01-01T00:00:00Z` | Go 的 `time.Time` 零值序列化结果，保证前端兼容 |
| UniqueID | 沿用 `<插件名>-<id>` 约定；插件结果 `channel` 必须为空字符串 | 原项目用 UniqueID 前缀推断"来源"，进而决定排序等级 |

> **已核实**：免费版 KV 操作属于"Cloudflare 服务子请求"（上限 1000/次），**不占** 50 次外部子请求额度；Cache API 调用则与 `fetch` 共用额度。依据 Cloudflare 官方文档的检索摘要，未逐页核对原文，如有出入以官方为准。因此 `SUBREQUEST_BUDGET` 只统计外部 `fetch`，默认 48。

## 3. 目录结构（目标）

```
Pansou-workers/
├─ wrangler.toml
├─ package.json / tsconfig.json / vitest.config.ts
├─ src/
│  ├─ index.ts                # Hono app 入口
│  ├─ types.ts                # SearchResult / Link / MergedLinks / SearchRequest ...
│  ├─ config.ts               # 环境变量解析（CHANNELS、ENABLED_PLUGINS、超时、预算…）
│  ├─ routes/{search,health}.ts
│  ├─ core/{http,pool,budget,html,time}.ts
│  ├─ links/{classify,clean,password,extract}.ts
│  ├─ tg/{search,parse}.ts
│  ├─ search/{service,merge,rank,filter,mergeByType}.ts
│  ├─ cache/{types,kv}.ts
│  └─ plugins/
│     ├─ types.ts / registry.ts
│     ├─ _helpers/{maccms,flarum,jsLiteral,seroval}.ts
│     └─ <17 个插件>.ts
├─ test/fixtures/...
├─ scripts/{capture-fixture,live-check,smoke}.ts
└─ docs/implementation-plan.md
```

## 4. 任务依赖总览

```
T0.1 ─┬─ T0.2 ─────────────┬─ T0.7 ─ T0.8 ─ T0.10
      ├─ T0.3 ─┬─ T0.4 ────┤
      │        ├─ T0.5 ────┼─ T0.6 ─┘
      │        └─ T0.9 ────┘
      └─────────────────────────────── T1.0 ─ T1.1 … T1.6 ─ T1.7
```

- 阶段 1 的 T1.1~T1.6 在 T0.3、T0.4、T0.5、T1.0 完成后可**并行**做。
- T0.6（TG）与 T0.7（搜索服务）可并行，T0.8 依赖 T0.7、T0.9。

---

## 5. 阶段 0：骨架

### T0.1 项目脚手架
- **依赖**：无　**估时**：0.5 天
- **内容**
  - `npm create hono` 或手工搭建，`wrangler.toml`（兼容日期、`nodejs_compat` 按需、KV 绑定占位）
  - `tsconfig`（strict、`@cloudflare/workers-types`）、`vitest`、`eslint`/`prettier`
  - `package.json` 脚本：`dev`、`test`、`typecheck`、`deploy:staging`
  - 一个 `/api/health` 的最小路由跑通 `wrangler dev`
- **验收**：`npm run typecheck && npm test` 通过；`wrangler dev` 访问 `/api/health` 返回 200。

### T0.2 类型与 API 契约
- **依赖**：T0.1　**估时**：0.5 天
- **内容**
  - 移植 `model/*.go`：`Link`、`SearchResult`、`MergedLink`、`MergedLinks`、`SearchResponse`、`Response`、`SearchRequest`、`FilterConfig`
  - 响应序列化工具：缺失时间输出零值字符串；`omitempty` 字段按原项目省略
  - 统一的成功/错误响应构造（`code:0,message:"success"` / `code:400,...`）
- **验收**：对一组手写样例，序列化 JSON 字段名、字段顺序、省略规则与原项目一致（用 Go 源码中 `json` tag 逐字段核对，写进单测）。

### T0.3 核心工具：HTTP / 并发 / 预算 / HTML
- **依赖**：T0.1　**估时**：1.5 天
- **内容**
  - `core/http.ts`
    - `fetchText` / `fetchJson`：UA 头、`AbortSignal.timeout`、响应体大小上限（对应 `ReadAllLimited`）、`redirect` 可选、非 2xx 抛带插件名前缀的错误
    - `fetchWithRetry`：次数、退避、仅对网络错误与 5xx/429 重试（对照原 `util/retry.go`）；**每次重试都计入预算**
    - 字符集：默认按 UTF-8；提供 `decode(bytes, charset)`（本阶段 17 个插件不需要 GBK，但接口预留）
  - `core/pool.ts`：`mapLimit(items, limit, fn)`，默认全局上限 6
  - `core/budget.ts`：`SubrequestBudget`（`take(n)`；超限抛 `BudgetExceeded`，上层按"该来源失败、不影响其他来源"处理）
  - `core/html.ts`：cheerio 封装与 spike 结论
  - `core/time.ts`：解析 RFC3339、`YYYY-MM-DD HH:mm:ss`（按 `Asia/Shanghai` 固定时区）、相对时间
- **验收**：单测覆盖超时、重试次数与预算扣减、体积超限、`mapLimit` 的并发峰值不超过上限。

### T0.4 链接识别、清洗与提取码
- **依赖**：T0.3　**估时**：2 天（含大量样例）
- **内容**（移植自 `util/regex_util.go` 957 行 + `util/parser_util.go` 前半）
  - `classify.ts`：`getLinkType(url)`，14 类（baidu、aliyun、quark、guangya、tianyi、uc、mobile、115、pikpak、xunlei、123、magnet、ed2k、others），含 123 网盘多域名
  - `clean.ts`：百度、天翼、UC、123、115、阿里、移动云盘的 URL 清洗/规范化
  - `password.ts`：`extractPassword(content, url)`、`isValidPassword`
  - `extract.ts`：`extractNetDiskLinks(text)`
  - **Go 正则改写**：`(?i)` → `i` 标志，`(?s)` → `s`，`\p{…}` → `u` 标志；Go 的 RE2 无回溯，改写后用测试验证没有灾难性回溯
- **验收**：把原项目 `util/*_test.go` 与 `util/testdata/` 里的样例（`parser_contract_test`、`password_near_test`、`parser_real_*_fixture_test`、`parser_types_probe_test`）转写成 vitest 用例并全部通过。

### T0.5 插件框架
- **依赖**：T0.3　**估时**：1 天
- **内容**
  - `plugins/types.ts`
    ```ts
    interface Plugin {
      name: string
      priority: 1 | 2 | 3 | 4          // 对应原项目等级
      skipServiceFilter: boolean
      search(keyword: string, ctx: PluginContext): Promise<SearchResult[]>
    }
    interface PluginContext { fetch: BudgetedFetch; ext: Record<string, unknown>; signal: AbortSignal }
    ```
  - `registry.ts`：静态注册（不做动态扫描）；按 `ENABLED_PLUGINS`（必须显式指定，与原项目一致）与请求的 `plugins` 参数取交集，大小写不敏感
  - 单插件隔离：超时（`PLUGIN_TIMEOUT`，默认 30 秒）、异常捕获，失败只记录、不影响其他插件
  - 结果后处理：强制 `channel=""`，校验 `uniqueId` 以 `<name>-` 开头
- **验收**：用 2 个假插件（一个慢、一个抛错）测试隔离与超时；`plugins` 参数选择行为与原项目一致。

### T0.6 TG 频道搜索
- **依赖**：T0.3、T0.4　**估时**：2 天
- **内容**（移植 `util/parser_util.go` 的 `ParseSearchResults` / `parseTgMessage` 及 `service/search_service.go` 的 `searchTG`、`searchChannelWithContext`）
  - 请求 `https://t.me/s/<channel>?q=<kw>`，翻页参数 `before=`；每频道页数上限可配置
  - 解析消息：标题（`extractTitle`）、正文、时间、图片、标签、消息 ID、提取链接与提取码；同一消息多个作品时的 `workTitle` 逻辑
  - 频道默认值 `tgsearchers7`，`CHANNELS` 环境变量覆盖，请求 `channels` 参数再覆盖
  - 每个频道一个来源缓存条目（`tg:<channel>`）
- **验收**
  - 用手工保存的 `t.me/s/...` 页面 fixture 跑通解析；
  - **在线检查（由你手动执行）**：确认从 Cloudflare 出口访问 `t.me/s/` 是否可行。如果被拦，需回到设计层面重新评估，所以这条要**尽早做**。

### T0.7 搜索服务：合并、排序、过滤
- **依赖**：T0.2、T0.5　**估时**：2.5 天
- **内容**（移植 `service/search_service.go` 的 `Search`、`mergeSearchResults`、`generateResultKey`、`selectBetterResult`、`sortResultsByTimeAndKeywords`、`mergeResultsByType`、`filterResponseByType`；`api/filter.go`）
  - 来源选择：`src` 取值 `all/tg/plugin`；`plugins` 全部列出等价于不指定
  - 去重合并：`generateResultKey`（UniqueID 优先，否则 title+channel）、完整度打分取更优
  - 排序：时间分档（≤1 天 500 … >1 年 20）+ 关键词优先级（`合集/系列/全/完/最新/附/complete`）+ 插件等级（1:+1000，2:+500，3:0，4:−200）
  - `results` 列表进一步过滤：`datetime` 非零 或 关键词优先级>0 或 插件等级≤2
  - `mergeResultsByType`：按网盘类型分组、链接去重、`cloud_types` 过滤、链接标题抽取（`extractLinkTitlePairs` 系列，约 230 行，先移植主路径，边角用例用 fixture 补）
  - `res` 取值：`merged_by_type`（默认）、`all`、`results`
  - 请求级 `filter.include/exclude`（include 为 OR，exclude 为 AND，大小写不敏感）
  - `skipServiceFilter` 的语义：移植时先对照 `search_service.go` 约 1200~1260 行的关键词匹配逻辑，再决定在哪一层生效
- **验收**：构造一组混合 TG+插件结果，对比 Go 版（本地跑原项目的排序函数或手算）得到相同的顺序与分组；`filter`、`cloud_types`、`res` 各一组用例。

### T0.8 HTTP API
- **依赖**：T0.7、T0.9　**估时**：1 天
- **内容**
  - `GET /api/search`：`kw`、`channels`（逗号分隔）、`conc`、`refresh`、`res`、`src`、`plugins`、`cloud_types`、`ext`（JSON）、`filter`（JSON），非法 JSON 返回 400 与原项目同样的错误信息
  - `POST /api/search`：JSON body，`kw` 必填
  - `GET /api/health`：返回启用的插件列表与数量（对应原项目 health 的字段，先对照 `api/router.go:45`）
  - CORS 中间件；统一错误处理（500 时 `code:500,message:"搜索失败: …"`）
  - **本阶段不做认证**；预留中间件挂载点
- **验收**：用 `app.request()` 做路由单测，GET 与 POST 同参数结果一致；错误码与信息对照原项目。

### T0.9 缓存与"尽快响应、持续补全"
- **依赖**：T0.3、T0.5　**估时**：2 天
- **内容**
  1. **先核实**：KV 读写计入子请求的口径，并写入本文件第 2 节（实测或查官方文档）
  2. `ResultCache` 接口 `get(key)`、`put(key, entry, ttl)`；KV 实现（序列化、TTL、`refresh=true` 跳过读缓存）
  3. 缓存键：`v1:<source>:<sha1(keyword)>`；每个来源一条，条目含 `{results, final, ts}`
  4. 编排器：
     - 并发启动所有选中的来源（受预算与并发池限制）
     - 等待"全部完成 或 `ASYNC_RESPONSE_TIMEOUT`"，取已完成来源的结果与缓存里已有的结果合并
     - 未完成的来源用 `ctx.waitUntil` 继续，完成后写缓存（`final=true`）
     - 来源失败不写 `final`，只写短 TTL 的失败标记，避免反复打站点
  5. TTL：完整结果与部分结果区分（对应 `CACHE_TTL` 与 `CACHE_PARTIAL_TTL_MINUTES`）
- **验收**：用假插件（延迟 0.5 秒、6 秒）验证：第一次请求只返回快的、第二次返回两者；`refresh=true` 绕过缓存；`waitUntil` 在单测里用 `ExecutionContext` mock 验证被调用。

### T0.10 部署与冒烟
- **依赖**：T0.8　**估时**：0.5 天
- **内容**
  - 创建 KV namespace，写入 `wrangler.toml`（staging / production 两套）
  - 环境变量文档：`CHANNELS`、`ENABLED_PLUGINS`、`ASYNC_RESPONSE_TIMEOUT`、`PLUGIN_TIMEOUT`、`SUBREQUEST_BUDGET`、`CACHE_TTL` 等
  - `scripts/smoke.ts`：对已部署地址发起 `src=tg`、`src=plugin`、`src=all` 三类请求，检查响应结构
- **验收**：staging 部署成功，冒烟脚本通过。

---

## 6. 阶段 1：17 个 A 级插件

> 子请求数为审阅时的估算（典型 / 最坏，最坏含重试）。优先级是原项目里的等级；"跳过过滤"指 `NewBaseAsyncPluginWithFilter(..., true)`。

### T1.0 插件测试与在线检查工具
- **依赖**：T0.3、T0.5　**估时**：1 天
- **内容**
  - `test/helpers`：`mockFetch(routes)` 按 URL/方法返回 fixture；统一的断言辅助（链接类型、必填字段、`channel===""`、`uniqueId` 前缀）
  - `scripts/capture-fixture.ts <plugin> <keyword>`：**由你在本机手动运行**，把上游真实响应保存为 fixture（脚本不会自动运行，不批量访问）
  - `scripts/live-check.ts [plugin…]`：对选中的插件发 1 次真实搜索，输出 HTTP 状态、耗时、结果条数、是否命中挑战页特征（如 `cf-mitigated`、`Just a moment`）。**这是淘汰失效/被拦插件的主要手段**。
  - 可选：受环境变量保护的调试路由 `GET /api/_debug/plugin/:name?kw=`，用于在已部署的 Worker 上做出口 IP 实测（生产默认关闭）
- **验收**：用一个假插件走通"fixture → mock → 断言"；`live-check` 在本地 `wrangler dev` 下能跑。

### T1.1 MacCMS 类（共享 helper）
共享 `plugins/_helpers/maccms.ts`：`GET ?ac=detail&wd=<kw>`，解析 `vod_down_from` 与 `vod_down_url`（以 `$$$` 分隔，按下标配对），用 `getLinkType` 识别网盘类型。

| 插件 | 优先级 | 子请求 | 要点 |
|---|---|---|---|
| wanou | 1 | 1 / 2 | 域名 `woog.nxog.eu.org` 是个人域名，存活性存疑；失败仅重试 1 次 |
| ouge | 2 | 1 / 2 | 同上，与 wanou 共用同一上游域名，注意不要重复请求 |

- **估时**：0.5 天　**验收**：两个插件的 fixture 用例通过；`live-check` 标注上游存活状态。

### T1.2 简单 JSON 接口类
| 插件 | 优先级 | 子请求 | 要点 |
|---|---|---|---|
| quarkres | 2 | 1 / 1 | `GET squark.cc.cd/api/search?kw=`，仅保留 URL 含 `pan.quark.cn` 的条目；需带 `Referer`；`code!==200` 视为失败 |
| ikantv | 3 | 1 / 3 | 上游是 PanSou 兼容聚合 API（`kw`、`limit=50`），结果直通；校验链接类型白名单与 `magnet`/`ed2k` 前缀 |
| meitizy | 2 | 1 / 3 | 单次 POST JSON（`size=10`），需带 `Origin`/`Referer`；按 URL 域名与参数补网盘类型与提取码 |
| melost | 3 | 3 / 3 | 3 页并发 POST（每页 30），请求体含 `search_ticket`/`fp_data`/`automated` 空字段；站点若加强指纹校验会失效，代码里没有握手逻辑 |

- **估时**：1 天　**验收**：fixture 用例通过；`melost` 在 `live-check` 中重点验证。

### T1.3 Flarum 论坛类（共享 helper）
共享 `plugins/_helpers/flarum.ts`：`GET /api/discussions?filter[q]=<kw>&page[limit]=…`，从帖子 `contentHtml` 里抽取网盘链接。

| 插件 | 优先级 | 子请求 | 要点 |
|---|---|---|---|
| dyyj | 2 | 1 / 3 | 1 次 API（`limit=100`，含 `mostRelevantPost.contentHtml`）。**砍掉**原代码里抓 HTML 详情页的回退路径，那条路径会被 Cloudflare 挑战拦住 |
| quark4k | 3 | 2 / 6 | 两页并发（`offset=0/50`，每页 50）；第 2 页前随机延迟 0.1~1 秒可保留或去掉；`X-Forwarded-For` 伪造头在 Workers 里会被覆盖，**直接删除**；跳过过滤 |

- **估时**：1 天　**验收**：fixture 用例通过；`dyyj` 不会发出任何详情页请求（用 mock 断言请求列表）。

### T1.4 磁力 / 种子类
| 插件 | 优先级 | 子请求 | 要点 |
|---|---|---|---|
| nyaa | 3 | 1 / 3 | `nyaa.si` 搜索页，取 `table.torrent-list` 每行的 `magnet:`；链接类型是 `magnet` 不是网盘；`title_en` 扩展参数需透传；可能对 Cloudflare 出口限流；跳过过滤 |
| cldi | 3 | 5 / 15 | 搜索页 1~5 并发；磁力由 URL 里的 40 位 hex 拼出，无需详情页；`(?i)` 改 `i` 标志；镜像域名存疑；跳过过滤 |
| feikuai | 3 | 1 / 4 | 先 `GET` JSON API，失败回退网页解析；md5 只用于回退路径的 UniqueID，**改用 SHA-1**（WebCrypto）；带时区的时间需手工解析；跳过过滤 |

- **估时**：1.5 天　**验收**：fixture 用例通过；`feikuai` 的 API 路径与回退路径各一组。

### T1.5 内嵌数据的 HTML 页
共享 `plugins/_helpers/jsLiteral.ts`：从 HTML 中抽取 `const x = JSON.parse('…')` 的单引号 JS 字符串（处理 `\xNN`、`\uNNNN`、`\'` 转义）与 `const x = [...]` 数组（括号配对截取）。

| 插件 | 优先级 | 子请求 | 要点 |
|---|---|---|---|
| haitunsou | 2 | 1 / 1 | `GET /s/<kw>.html`，页面内 `const list = JSON.parse('…')`，需解码转义再 `JSON.parse` |
| zlxapp | 3 | 1 / 3 | `GET /s/<kw>.html`，页内 `const listItemsData = [...]`，原代码手写括号匹配 `findJSONArrayEnd`；响应上限 2MB |

- **估时**：1 天　**验收**：helper 单测覆盖转义、嵌套括号、字符串里含括号等情况；两个插件 fixture 通过。

### T1.6 编码与多页类
| 插件 | 优先级 | 子请求 | 要点 | 估时 |
|---|---|---|---|---|
| quarksoo | 3 | 1 / 3 | `GET /search.php?q=`，解析结果页夸克链接；md5 仅用于 UniqueID，**改用 SHA-1**；随机 UA/XFF 去掉 | 0.5 天 |
| yunsou | 2 | 5 / 10 | 搜索页 1 → 按总页数最多再取 9 页；链接在 `onclick` 的 `copyText('…','…','url','pwd')` 里，需先 HTML 反转义再正则；**默认只取前 3 页**（可配置） | 1 天 |
| yunso | 3 | 3 / 9 | 并发 POST 3 页（每页 20），返回 JSON 内嵌 HTML 片段；新版直接给 URL，旧版 base64 + XOR（32 字节硬编码密钥）；无重试 | 1 天 |
| xiaokupan | 2 | 1 / 4 | `GET _serverFn/<id>`，响应是 **TanStack Seroval 节点树**，需实现引用节点（`t=4`）解析；函数 ID 硬编码，失效时从首页抓 `assets/index-*.js` 用正则重取，ID 可缓存到 KV | 2 天（本组最难） |

- **共享**：`plugins/_helpers/seroval.ts`（仅覆盖该站点用到的节点类型即可，不做通用实现）。
- **验收**：fixture 用例通过；`xiaokupan` 的"函数 ID 失效 → 重新发现 → 重试一次"路径有 mock 测试。

### T1.7 注册、集成测试与上线
- **依赖**：T1.1~T1.6、T0.10　**估时**：1 天
- **内容**
  - 在 `registry.ts` 注册 17 个插件，`ENABLED_PLUGINS` 默认值写入文档
  - 集成测试：对每个插件 mock 上游，通过 `/api/search?src=plugin&plugins=<name>` 走完整链路
  - 子请求预算核算（见下节），把 `yunsou`、`cldi` 的页数上限设成配置项
  - 在 staging 上逐个跑 `live-check`，**把失败/被拦的插件从默认启用列表中移除并记录原因**，更新可移植性报告
- **验收**：staging 上 `src=plugin` 全量查询在预算内返回；失败插件有记录。

---

## 7. 子请求预算核算（阶段 1 全部插件同时启用）

按审阅估算累加：

- **典型**：1+1+1+1+1+1+1+5+1+1+1+5+1+1+2+3+3 ≈ **31**
- **最坏（含重试）**：4+1+3+3+3+3+2+10+3+4+2+15+1+3+6+9+3 = **75**
- 再加 TG：每个频道至少 1 次（有翻页则更多）

结论（已按免费版落地）：
- 免费版外部子请求上限 50，`SUBREQUEST_BUDGET` 默认 48；17 个插件同时启用时典型约 31、最坏约 75，**最坏情况下靠预算耗尽让部分来源失败而不影响其他来源**。
- 已把 `yunsou`、`cldi` 页数默认降到 3，并把部分插件的重试降为 1~2 次；`MAX_TG_CHANNELS` 默认 1。
- KV 读写不占此额度（见第 2 节）。若要保证最坏情况也不丢来源，需升级付费版或减少 `ENABLED_PLUGINS`。

## 8. 里程碑与时间线（单人粗估）

| 里程碑 | 包含 | 累计估时 |
|---|---|---|
| M0 可跑的空壳 | T0.1、T0.2 | 1 天 |
| M1 核心能力就绪 | T0.3、T0.4、T0.5 | 6.5 天 |
| M2 TG + 搜索服务 + API | T0.6、T0.7、T0.8、T0.9 | 14 天 |
| M3 阶段 0 上线 staging | T0.10 | 14.5 天 |
| M4 阶段 1 插件完成 | T1.0~T1.6（共 10.5 天） | 25 天 |
| M5 阶段 1 联调上线 | T1.7 | 26 天 |

以上是**全部串行**的总和。T0.6 与 T0.7 可并行，阶段 1 的 T1.1~T1.6 在 T1.0 完成后互相独立也可并行；两人协作大致可压缩到 15~18 天（粗估，未计联调与站点实测的等待时间）。

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Cloudflare 出口访问 `t.me/s/` 被拦或限流 | TG 搜索不可用 | T0.6 **最先做在线实测**；不可用则 TG 降级为可选，重新评估价值 |
| 目标站点已失效或拦截 Cloudflare 出口 IP | 部分插件无结果 | T1.0 的 `live-check` + T1.7 淘汰；插件列表做成配置，随时开关 |
| 个人域名/镜像域名不稳定（wanou、ouge、cldi 等） | 结果不稳定 | 域名做成可配置项；失败写短 TTL 失败标记避免反复请求 |
| Go 正则改写成 JS 后行为不一致 | 解析错误 | T0.4 把 Go 侧测试样例全部转写；对关键正则逐个对照 |
| 上游改版（尤其 xiaokupan 的函数 ID） | 插件失效 | 保留"重新发现"路径与 fixture 回归测试 |
| 缓存写入并发覆盖 | 慢插件结果丢失 | 按来源分条缓存，避免读改写同一条 |
| KV 计入子请求导致预算不足 | 免费版吃紧 | **已核实**：KV 属于 Cloudflare 服务子请求（上限 1000），不占 50 次外部额度 |
| **免费版 CPU 每请求仅 10ms** | 未命中缓存的查询解析 TG 页面（本机实测单频道 5~8ms）+ 多插件合并排序，可能触发 Error 1102 | `node-html-parser` + 预编译正则；`MAX_TG_CHANNELS` 默认 1；缓存命中几乎不耗 CPU；上线后实测，必要时优化解析或升级付费版 |

## 10. 决定记录与仍待确认

已确认/已决定：
1. **Cloudflare 套餐**：免费版（已按此落地）。
2. **代码位置**：直接在当前目录 `Pansou-workers/`，按 GitHub 仓库习惯组织，后续用 GitHub Actions 部署。
3. **HTML 解析库**：`node-html-parser`（因免费版 CPU 限制）。
4. **时间策略**：无时区时间按 UTC（与原项目一致）。
5. **认证**：静态 Token（`API_TOKEN`），不做 JWT 登录。
6. **配置格式与 KV**：`wrangler.toml`；KV 由 wrangler 自动创建并绑定，不再需要 `KV_NAMESPACE_ID`。

仍待你确认：
1. **在线实测由你手动执行**：`live-check` / `capture-fixture` 会向第三方站点发真实请求，我不会自动批量运行。
