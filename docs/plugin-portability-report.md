# PanSou 插件 → Cloudflare Workers（TypeScript）可移植性报告

> 评估对象：[fish2018/pansou](https://github.com/fish2018/pansou) `main` 分支，`plugin/` 下全部带代码的插件目录（112 个；另有空目录 `pioz` 已忽略）。
> 评估方式：静态审阅源码，不联网访问目标站点。

## 1. 结论摘要

| 评级 | 含义 | 全部 | 其中已注册 |
|---|---|---|---|
| **A** | 无状态、子请求少、基本直译 | 24 | 17 |
| **B** | 可移植，但需额外工作（详情页扇出、编码、哈希/AES、握手、SSE） | 63 | 42 |
| **C** | 需持久状态/用户凭据，或子请求常超 30，第一版不建议 | 15 | 9 |
| **D** | 不建议移植 | 10 | 7 |

- **"已注册"** 指在 `main.go` 里被 `import` 编译进二进制的插件，共 75 个；其余 37 个目录存在但未注册（其中 3 个被显式注释：erxiao、jupansou、qupanshe）。
- **约 78% 的插件（A+B）技术上可移植**，但 B 级里绝大多数的成本不在"改写语法"，而在**每次搜索的子请求数**：搜索页 + 逐条详情页的结构非常普遍，直译会撞上 Workers 的子请求上限。
- 最保守的第一版可以只做 **17 个已注册的 A 级插件**，再加 TG 频道搜索；之后按第 5 节分批扩展。
- 评估的目标站点是否仍然存活、从 Cloudflare 出口 IP 是否会被拦，**本次没有验证**（见第 2 节"局限"）。

## 2. 评估方法与局限

**方法**
1. 下载仓库源码，对每个插件做正则静态扫描（文件写入、cloudscraper、cookiejar、md5/sha/aes、GBK、gzip、SSE、明文 http 等），得到特征指标。
2. 将插件按代码量均分为 8 组，由 8 个子代理逐个阅读主搜索路径，按统一字段输出：请求链、子请求数、认证方式、反爬方式、Go 特有写法、链接来源、状态依赖、评级、工作量。
3. 我抽查了 6 条关键结论（xdpan、huban、dy4k、hjzhencai、pan365、nsgame），与源码一致。

**局限（请按此调整对数字的信任度）**
- **子请求数多为估算**。很多插件的详情页条数没有代码上限，只能按"站点单页约 10~20 条"估；"最坏"值包含重试（多数插件每个请求最多重试 2~3 次）。置信度 `M` 的估算误差可能较大。
- **没有验证站点存活**。批量探测第三方站点的请求被权限拦截，我没有绕过；因此"站点已失效"不会体现在评级里。移植前请对入选插件逐个实测。
- **没有验证 Cloudflare 出口 IP 是否被目标站拦截**。评级里的"反爬风险"来自代码线索（如代码自带 Cloudflare 挑战判断、cloudscraper、PoW），不是实测。
- 评级基于"精简版、按付费版规划"；免费版 50 子请求的上限会让更多 B 级退化到 C。
- confidence 分布：high 50，medium 61，low 1。

**Workers 限制基准**：子请求每次调用 免费 50 / 付费 1000；同时打开的出站连接 6 个；无文件系统与常驻内存；WebCrypto 无 MD5；fetch 不能关闭 TLS 校验；出口为 Cloudflare 数据中心 IP。
裸 IP 与非标端口的访问限制我记得是 fetch 不支持，但没有逐条核对官方文档，**实现前请实测**。

## 3. 总体画像

- 类型：HTML 64、JSON API 31、混合 13、SSE 4。
- 认证：无 84；运行时握手（无需用户凭据）18；代码内硬编码密钥 5；需用户凭据 5。
- 反爬：仅 UA 头 86；其他 15；Cloudflare 挑战 4；自定义签名/加密 4。
- **最坏子请求数 ≤ 50（免费版可容纳）的插件：78 个**；>50 的 34 个，必须给详情页数量封顶后才能用。
- 工作量：S 41、M 55、L 16。

## 4. 跨插件移植要点（Go → TS 对照）

| 主题 | 涉及插件 | 处理建议 |
|---|---|---|
| 并发抓取（Go 里用 goroutine；多用于逐条抓详情页） | 使用 goroutine 的插件共 86 个，具体扇出规模见第 6 节「子请求」列 | 抽成统一的 `mapLimit(urls, 6, fn)`；**每个插件必须设详情条数上限**（建议 10~20），否则超子请求上限；并发不要超过 6 |
| GBK/GB18030 | yulinshufa、5266ys、dygang | 响应用 `TextDecoder('gb18030')`；**请求关键词的 GBK 百分号编码 `TextEncoder` 做不了**，需自带 GBK 编码表或引入纯 JS 编码库 |
| MD5 | quarksoo、qiwei、jupansou、javdb、feikuai | WebCrypto 不支持，需纯 JS 库；若只是生成 UniqueID，可直接改用 SHA-1/SHA-256 |
| SHA / AES | SHA：14 个；AES：gying、qqpd、panlian、miaoso、sdso | WebCrypto 直接支持；注意 Go 的 padding/模式要与 `AES-CBC` 对齐 |
| 手动 gzip | xb6v、libvio、xiaozhang、leijing、qupanshe | `fetch` 自动解压，删掉手动解压逻辑 |
| cookiejar | gying、qqpd、miosou、panlian、ting77、weibo、qiwei、nsgame、jupansou、panyq、woniu、qupanshe | 没有 CookieJar；需要自己解析 `Set-Cookie` 并在后续请求带 `Cookie`（单次搜索内手动维护即可） |
| 读取 302 的 Location | notes 中标注 `redirect:manual` 的插件（xiaozhang、panzun、qupanshe 等） | `fetch(url,{redirect:'manual'})` 读 `Location`（Workers 支持） |
| SSE | buerchen、sopanya、miosou、jupansou | 用 `response.body` 流式读取；注意 CPU 时间 |
| 明文 http / 裸 IP / 非标端口 | qingying、yulinshufa、zhizhen、shandian、kkv、huban、muou、lou1、labi | 明文 http 可 fetch，但站点若强制 https 会失败；裸 IP 与非标端口按第 2 节说明需实测 |
| Go 正则内联标志 `(?i)` 等 | 25 个 | 改写成 JS 标志位 `/…/i`；`(?s)` 对应 `s` 标志；`\p{…}` 需加 `u` 标志 |
| 内存状态（sync.Map、限流冷却、进程内缓存） | 多个 | Workers isolate 不保证复用，状态改放 KV/Cache API，或接受"无状态" |
| 磁盘落盘（登录态/Cookie） | gying、qqpd、panlian、weibo、panyq、woniu | 必须换 KV/D1；其中多数还依赖扫码/账号登录，见 C/D |
| 注册 Web 路由（插件自带管理页） | gying、qqpd、panlian、weibo、woniu | 精简版直接砍掉 |
| `time.Parse`、中文日期 | 74 个 | 统一写一个 `parseDate`，注意 Go 代码里常按 `Asia/Shanghai` 固定时区解析 |

## 5. 推荐移植路线

**阶段 0：骨架**
Hono + wrangler；统一的 `Plugin` 接口（`search(keyword): Promise<Result[]>`）、`mapLimit`、`fetchWithRetry`（带超时）、HTML 解析封装、网盘链接正则分类（13 类）、KV 缓存、`waitUntil` 异步补全。再加 TG 频道搜索。

**阶段 1：已注册的 A 级（17 个，直译即可）**
haitunsou、quarkres、ouge、wanou、dyyj、ikantv、meitizy、melost、nyaa、quarksoo、zlxapp、feikuai、xiaokupan、quark4k、yunso、yunsou、cldi

**阶段 2：已注册的 B 级，且最坏子请求 ≤ 50、工作量 S/M（29 个）**
u3c3、488run、kkv、hunhepan、aipan、rrbt、pan365、pansearch、cyg、duoduo、erxiaopan、thepiratebay、xiaoyu、duanjuw、jsnoteclub、leso、kpkuang、clxiong、lou1、buerchen、clmao、djgou、dyyjpro、sousou、quarktv、xiaozhang、jutoushe、labi、yulinshufa

**阶段 3：其余已注册的 B 级（13 个）**：详情页扇出过大或需额外加解密/握手，封顶详情条数后再逐个做。
5266ys、dygang、hjzhencai、xb6v、hdmoli、nsgame、muou、shandian、gaoqing888、lingjisp、yingso、zhizhen、susu

**阶段 4（可选）**：未注册的 A/B 级共 28 个（A：jikepan、miaoso、qupansou、ash、xdyh、bixin、pan666；B：qupanshe、xys、yiove、kkmao、pianku、hdr4k、xiaoji、leijing、xuexizhinan、ypfxw、qingying、yuhuage、alupan、mizixing、ahhhhfs、daishudj、panta、xinjuc、javdb、sdso、aikanzy）。它们在原项目里没有启用，可能是已知失效或质量问题，**先确认再做**。

**不建议做**：C 级 15 个、D 级 10 个，见第 7 节。

## 6. 全量明细

> 表格列说明：子请求数为估算；认证/反爬取值见评估字段定义；置信 H/M/L 分别表示 high/medium/low。

### A 级：直译（24个）

| 插件 | 状态 | 类型 | 子请求 典型/最坏 | 认证 | 反爬 | 工作量 | 置信 | 要点 |
|---|---|---|---|---|---|---|---|---|
| haitunsou | 已注册 | html | 1 / 1 | none | ua-header-only | S | H | 结果以 const list = JSON.parse('...') 内嵌于HTML，需括号扫描+JS转义解码再JSON.parse(TS里可直接JSON.parse补转义)；仅1次请求 |
| quarkres | 已注册 | json-api | 1 / 1 | none | ua-header-only | S | H | 最简JSON接口,仅留url含pan.quark.cn的条目;需带Referer;时间RFC3339 |
| ouge | 已注册 | json-api | 1 / 2 | none | ua-header-only | S | H | 标准MacCMS ac=detail;down_from/down_url按$$$配对;eu.org域名稳定性存疑 |
| wanou | 已注册 | json-api | 1 / 2 | none | ua-header-only | S | H | 链接在vod_down_url字段按$$$对齐，正则识别网盘类型；失败仅重试1次；域名woog.nxog.eu.org为个人域名，稳定性存疑 |
| dyyj | 已注册 | json-api | 1 / 3 | none | other | S | H | 仅1次API(含mostRelevantPost.contentHtml)；HTML详情页被CF挑战，回退路径(详情扇出)须砍掉；失败重试最多3次 |
| ikantv | 已注册 | json-api | 1 / 3 | none | ua-header-only | S | H | 上游本身是PanSou兼容聚合API，结果直通即可；失败最多重试3次；只需校验链接类型白名单与magnet/ed2k前缀 |
| meitizy | 已注册 | json-api | 1 / 3 | none | ua-header-only | S | H | 仅1次POST apis.451024.xyz；需带Origin/Referer；按URL域名与参数补网盘类型和密码 |
| melost | 已注册 | json-api | 3 / 3 | none | other | S | M | 请求体含search_ticket/fp_data/automated空字段，站点若加强指纹校验会失效(代码未实现握手)；无重试 |
| nyaa | 已注册 | html | 1 / 3 | none | ua-header-only | S | H | 仅1次GET，直接取table.torrent-list行内magnet；链接类型为magnet非网盘；nyaa.si可能对CF出口IP限流，title_en扩展参数需传入 |
| quarksoo | 已注册 | html | 1 / 3 | none | ua-header-only | S | H | 仅1次GET；md5仅用于生成UniqueID，可换SHA-1/简单哈希；随机UA/XFF可去掉；重试2次 |
| zlxapp | 已注册 | mixed | 1 / 3 | none | ua-header-only | S | H | 结果嵌在HTML内联脚本 const listItemsData = [...]，需手写括号匹配截取JSON(findJSONArrayEnd)；响应上限2MB；重试2次 |
| feikuai | 已注册 | mixed | 1 / 4 | none | ua-header-only | S | H | API直返磁力;md5仅用于回退路径UniqueID(可换SHA-1);(?i)改i标志;带时区时间手解 |
| xiaokupan | 已注册 | json-api | 1 / 4 | runtime-handshake | none | M | M | 响应为Seroval节点树(需实现引用解析)；serverFn哈希ID硬编码，失效时从首页→assets/index-*.js正则重取，ID可存KV；无状态也可用 |
| quark4k | 已注册 | json-api | 2 / 6 | none | ua-header-only | S | H | 固定2页(PageSize=50)，第2页前随机延迟0.1~1s；X-Forwarded-For伪造头在Workers里可能被忽略；重试2次 |
| yunso | 已注册 | mixed | 3 / 9 | static-key-in-code | ua-header-only | S | H | 接口返回JSON内嵌HTML片段需解析(linkedom/cheerio)；新版直接给URL，旧版base64+XOR(32字节密钥)；无重试 |
| yunsou | 已注册 | html | 5 / 10 | none | ua-header-only | S | H | 链接在onclick的copyText('..','..','url','pwd')里,需HTML反转义后正则;最多10页顺序请求,可只取前2~3页 |
| cldi | 已注册 | html | 5 / 15 | none | ua-header-only | S | H | 磁力由URL中40位hex拼出,无需详情页;每页最多重试3次;(?i)改i标志;镜像域名存疑 |
| jikepan | 未注册 | json-api | 1 / 1 | none | ua-header-only | S | H | 单次POST，仅需映射service类型(189cloud→tianyi,caiyun→mobile)；默认未启用 |
| miaoso | 未注册 | json-api | 1 / 1 | static-key-in-code | ua-header-only | S | H | url为base64的AES-CBC密文，key/iv/satoken硬编码；WebCrypto自动去PKCS7；默认未启用 |
| qupansou | 未注册 | json-api | 1 / 1 | none | ua-header-only | S | H | 单次POST,pageSize=1000响应可能较大;按host映射网盘类型;无提取码 |
| ash | 未注册 | html | 1 / 2 | none | ua-header-only | S | H | 正则取内嵌var jsonData，需替换\/并去控制字符；修正pan.qualk.cn为pan.quark.cn；未注册 |
| xdyh | 未注册 | json-api | 1 / 3 | none | none | S | H | 单次POST到第三方聚合服务，服务端并发多站点耗时长(超时15s)；重试最多3次；中间还有内存缓存，TS里可去掉 |
| bixin | 未注册 | json-api | 2 / 6 | none | ua-header-only | S | M | 仅2页(offset 0/50)，链接在mostRelevantPost的HTML里需正则/解析抽取；随机UA/XFF/延迟可去掉(Workers不能伪造X-Forwarded-For意义不大) |
| pan666 | 未注册 | json-api | 2 / 6 | none | ua-header-only | S | M | 链接在contentHTML内需清洗标签后用多套正则提取；随机X-Forwarded-For/UA在Workers中不必保留；main.go未import该插件(当前未启用)，pan666.net是否可用未验证 |

### B 级：可移植，需额外工作（63个）

| 插件 | 状态 | 类型 | 子请求 典型/最坏 | 认证 | 反爬 | 工作量 | 置信 | 要点 |
|---|---|---|---|---|---|---|---|---|
| u3c3 | 已注册 | html | 2 / 8 | none | other | S | H | 每次需先抓首页正则提取var nmefafej="…"得search2(Go内存缓存1h，Workers建议KV缓存)；有主域+旧域名回退；结果为磁力链 |
| 488run | 已注册 | json-api | 5 / 9 | runtime-handshake | other | M | M | 须先取yd_frontend cookie；异步结果poll最多6次(间隔420ms)；401刷新重试 |
| kkv | 已注册 | html | 11 / 11 | none | ua-header-only | S | H | 基址是明文http://kkv.q-23.cn(可能被拦)；maxResults=10，每请求内置3次重试 |
| hunhepan | 已注册 | json-api | 12 / 12 | none | ua-header-only | S | H | hunhepan/qkpanso/kuake8/misoso四站各取3页共12次POST，并发上限6会排队；任一站失败可忽略；响应直接含链接与提取码 |
| aipan | 已注册 | json-api | 13 / 13 | none | ua-header-only | S | H | maxSearchItems=12、并发6，纯JSON直译；链接类型由kind字段或host映射，需带Referer/Origin头 |
| rrbt | 已注册 | html | 13 / 13 | none | ua-header-only | S | H | 仅百度；链接在.down a.red的href?gourl，去M6前缀/_@_后缀后base64url解码 |
| pan365 | 已注册 | json-api | 14 / 14 | runtime-handshake | other | M | M | 最多2搜索+12次POST解析(并发3)；站点有安全验证(403/42901)，CF出口IP可能被拦；冷却状态为内存，需KV才能跨请求 |
| pansearch | 已注册 | json-api | 6 / 14 | runtime-handshake | ua-header-only | M | H | 需先从首页正则抓buildId再调_next/data接口，宜存KV；最多5页；(?i)正则改i标志 |
| cyg | 已注册 | json-api | 21 / 21 | none | ua-header-only | S | H | 1次搜索+每帖1次download接口(per_page默认20,ext可调大则线性增长);重试最多3次;纯JSON易直译 |
| duoduo | 已注册 | html | 11 / 21 | none | ua-header-only | S | M | 详情页数=搜索结果数,代码无上限(maxcms单页通常~10条);并发20需限制为6;详情缓存是内存sync.Map可去掉。 |
| erxiaopan | 已注册 | html | 16 / 22 | none | ua-header-only | M | H | 详情页扇出≤20(并发5,含3次重试时更多);下载区链接为/s/xxx相对路径+提取码需按hostmap重组;模块内详情缓存可丢弃。 |
| thepiratebay | 已注册 | html | 10 / 30 | none | ua-header-only | S | M | 最多30页并发(Go并发200,Workers仅6);磁力在列表内;镜像域可能失效,页数可砍到3~5;时间缺年份 |
| xiaoyu | 已注册 | html | 5 / 30 | none | ua-header-only | S | H | maxPages=10，总页数取自页面'x/y'；每请求重试2次(最坏30)；链接在data-url属性base64，sha256仅用于生成ID |
| duanjuw | 已注册 | html | 11 / 31 | none | ua-header-only | M | M | 无上限：详情页数=结果条数(估10~20)；两种页面结构；(?m)(?i)内联标志需转JS；缓存为进程内 |
| jsnoteclub | 已注册 | mixed | 10 / 32 | runtime-handshake | ua-header-only | M | M | 先从首页script正则取content key；全站帖子列表(limit=10000)很大可缓存 |
| leso | 已注册 | html | 20 / 32 | none | ua-header-only | M | M | Discuz搜索POST后302到searchid页(需手动跟随，Workers用redirect:manual)；maxResults=30并发6；Discuz搜索可能有间隔限流，正则用大量(?i) |
| kpkuang | 已注册 | mixed | 11 / 34 | static-key-in-code | ua-header-only | M | H | maxSearchItems=10；详情页链接为@@@encrypted@@@XOR自定义加密，需移植decryptMyString；3镜像域依次回退最坏34请求 |
| clxiong | 已注册 | html | 20 / 36 | runtime-handshake | ua-header-only | M | H | 搜索POST返302，fetch需redirect:manual取searchid；最多30详情页；一页可拆多条磁力 |
| lou1 | 已注册 | mixed | 13 / 39 | none | ua-header-only | M | H | baseURL为明文http://www.1lou.me；searchLimit=12固定扇出12详情；重试3次(最坏39)；仅保留夸克等链接分类 |
| buerchen | 已注册 | sse | 16 / 40 | runtime-handshake | ua-header-only | M | M | SSE需流式解析(读到上限提前断开)；每候选再POST save_url(站点代存)才得到链接，最多18候选(每日更新另加decrypt)；缓存/冷却可用KV |
| clmao | 已注册 | html | 13 / 40 | none | ua-header-only | M | M | 关键词需base64；HTML里atob载荷要base64+URL解码；仅磁力；详情数无硬上限 |
| djgou | 已注册 | html | 12 / 40 | none | other | M | M | 宝塔WAF返回JS跳转页(正则取window.location的btwaf=URL再请求)，Workers需手动带cookie；详情无上限(page=1单页)；只出夸克链接 |
| dyyjpro | 已注册 | html | 11 / 40 | none | ua-header-only | M | M | 详情页扇出无上限(WP主题单页约10~12条)，并发12；每请求最多3次重试；站点可能有CF防护需验证 |
| sousou | 已注册 | html | 21 / 40 | none | ua-header-only | M | M | 主路径为panso.vip搜索页+逐条详情(条数无上限，约20)；旧API回退(6网盘×3页=18请求)已被403基本失效，可砍掉 |
| quarktv | 已注册 | mixed | 21 / 41 | none | ua-header-only | M | H | 无上限：每篇文章2请求(详情页+wp-json pan_view)，WP默认10条≈21；重试最坏翻倍 |
| xiaozhang | 已注册 | html | 21 / 41 | none | ua-header-only | M | M | 每条结果2次请求(redirect:manual取Location);条数无上限(单页约10~20);gzip交给fetch |
| jutoushe | 已注册 | html | 13 / 45 | none | ua-header-only | S | M | 详情页串行请求无数量上限(估10~15条)，Workers需改为并发(限6)；搜索请求重试最多3次；链接直接在详情页href |
| labi | 已注册 | html | 13 / 45 | none | ua-header-only | M | M | 镜像全为明文http；搜索对3镜像并行(占3子请求)；详情扇出数取决于搜索页条数(估~12)；内存detailCache无法跨请求 |
| yulinshufa | 已注册 | html | 16 / 48 | none | ua-header-only | M | H | 站点为http明文且关键词需GBK百分号编码、页面GBK解码；maxSearchResults=15个详情页(各最多3次重试)，每次需受限并发 |
| 5266ys | 已注册 | html | 21 / 51 | none | ua-header-only | M | M | 关键词需GB18030编码后百分号转义(TextEncoder不支持gbk编码，需引入编码表)，响应用TextDecoder('gb18030')；详情最多50个，建议限10 |
| dygang | 已注册 | html | 25 / 51 | none | ua-header-only | M | H | 关键词需GB18030编码再urlencode,响应/详情用TextDecoder('gb18030');详情上限50,建议截前20 |
| hjzhencai | 已注册 | html | 25 / 51 | none | ua-header-only | M | M | 3页串行+48详情，最坏51>免费50上限，建议详情封顶约20；固定时区解析时间 |
| xb6v | 已注册 | html | 21 / 52 | none | ua-header-only | M | M | POST后需fetch redirect:manual读Location，缺失时正则从body找searchid；详情最多50个，建议精简到10；手动gzip在fetch中无需处理；idx*100ms错峰 |
| hdmoli | 已注册 | html | 16 / 53 | none | ua-header-only | M | M | 最多50条各一次详情(Go并发20,Workers仅6);需限制条数控制子请求 |
| nsgame | 已注册 | json-api | 14 / 54 | runtime-handshake | custom-sign-or-encrypt | M | M | SHA256 PoW循环(最多1e7次)CPU风险，用同步JS sha256；需带cookie；详情最多50 |
| muou | 已注册 | html | 16 / 60 | none | ua-header-only | M | M | 同时打6个镜像(含http明文)竞速,TS建议只留主域;详情条数无上限 |
| shandian | 已注册 | html | 15 / 60 | none | ua-header-only | M | M | 三个镜像全部http明文(sduc.cloud/shandian.blog/sd.sduc.site)，3个搜索请求总会全发；详情数无上限；结构同zhizhen(MacCMS)，可与其共用解析 |
| gaoqing888 | 已注册 | html | 11 / 63 | none | ua-header-only | M | M | 扇出无上限(搜索页条数估~10~20)；/go/play?url=参数直接取目标无需跟随跳转；所有请求重试3次；需截断N条 |
| lingjisp | 已注册 | json-api | 21 / 63 | static-key-in-code | none | M | H | app_id/identity硬编码在源码；1次列表+最多20次详情(并发6)；每请求最多3次重试；站点mukaku.com接口可能变动 |
| yingso | 已注册 | json-api | 32 / 63 | runtime-handshake | custom-sign-or-encrypt | M | H | 每次先GET配置再XOR加密请求；每条需一次getKey约32次，建议裁剪前10条；按UTF-16码元XOR |
| zhizhen | 已注册 | html | 13 / 63 | none | ua-header-only | M | H | 仅支持http://www.mihdr.top(HTTPS握手失败，勿改https)；详情数无上限(取决于搜索页条数，约10~20)；站点慢(搜索页最长17s,详情最长14s)，超时需放大 |
| susu | 已注册 | mixed | 25 / 141 | none | ua-header-only | M | M | 两级扇出(每帖1+每按钮1)随条数增长宜封顶；链接在JWT里需base64url解码 |
| qupanshe | 已注释停用 | html | 3 / 5 | runtime-handshake | ua-header-only | M | M | Discuz三步,需手动带Set-Cookie、redirect:manual读Location;固定sleep 2s;链接取自摘要 |
| xys | 未注册 | mixed | 2 / 6 | runtime-handshake | ua-header-only | S | H | 先抽const DToken再POST(原有30分钟内存缓存,可选KV);data是HTML;url属性base64 |
| yiove | 未注册 | html | 13 / 13 | none | ua-header-only | M | H | 关键词逐字节转'_'+大写hex；详情上限12；默认main.go未启用 |
| kkmao | 未注册 | html | 11 / 21 | none | ua-header-only | S | M | 仅夸克链接;详情数=搜索页文章数(WP约10条,无硬上限);提取码需从周边文本正则找 |
| pianku | 未注册 | html | 11 / 21 | none | ua-header-only | M | M | 无上限：详情页数=搜索页条数(估10~20)，Go串行，TS需并行；多网盘正则；未注册 |
| hdr4k | 未注册 | html | 11 / 25 | none | ua-header-only | M | M | Discuz搜索常有访客限频(flood control)；扇出无上限(搜索页约10~20条)；init里的缓存清理goroutine和随机UA可丢弃 |
| xiaoji | 未注册 | html | 13 / 25 | none | ua-header-only | M | M | Go里详情串行，TS须并行；链接为/go.html?url=base64需解码；条数无硬上限 |
| leijing | 未注册 | html | 11 / 31 | none | ua-header-only | S | M | 无上限：详情页数=首页结果数(估10~30)；手动gzip在fetch里自动解压；仅天翼链接；未注册 |
| xuexizhinan | 未注册 | html | 11 / 31 | none | ua-header-only | M | M | 仅第一页,每条一次详情(并发8),数量取决于站点每页条数;磁力在li文本,夸克在.site-go a |
| ypfxw | 未注册 | html | 13 / 31 | none | ua-header-only | M | M | 结果全部抓详情(无硬上限,约10~30条)；提取码靠正则；默认main.go未启用 |
| qingying | 未注册 | html | 11 / 33 | none | ua-header-only | S | M | 站点为http://revohd.com明文(Workers可fetch但需确认80口出站)；maxResults=10，只出123盘，链接在data-clipboard-text属性；重试至3次 |
| yuhuage | 未注册 | html | 11 / 33 | none | ua-header-only | S | M | 详情数=搜索页条数(无上限约10~20),失败最多重试3次;thunder归类others;429内存限流标志可忽略 |
| alupan | 未注册 | html | 13 / 38 | none | ua-header-only | M | M | 详情页扇出无条数上限(约10~12条)，并发12；搜索重试3次、详情2次；提取码需从链接周边文本匹配 |
| mizixing | 未注册 | html | 13 / 39 | none | ua-header-only | M | M | searchLimit=12，详情并发6；详情提取用正则linkPatterns+提取码匹配，注意Go正则内联标志转换；重试最多3次 |
| ahhhhfs | 未注册 | html | 11 / 40 | none | ua-header-only | M | M | 详情页扇出无条数上限(WP首页约10~12条)，并发15超过6连接上限需排队；每请求最多3次重试；网盘类型靠域名判断 |
| daishudj | 未注册 | html | 11 / 40 | none | ua-header-only | M | M | 详情扇出无上限(WP默认每页约10条，估11请求)；重试3次；需自行截断N条以控制子请求 |
| panta | 未注册 | html | 16 / 40 | none | ua-header-only | M | M | 详情扇出数无硬上限(取决于搜索页条数，估15~20)，需自行截断前N条；Go内存缓存/自适应并发要丢弃；重试2次 |
| xinjuc | 未注册 | html | 11 / 40 | none | ua-header-only | S | M | 详情无上限(单页约10~12条，无分页)，只出百度链接；原有1h内存缓存可改KV/Cache API；搜索请求重试至多3次 |
| javdb | 未注册 | html | 21 / 51 | none | other | M | M | 详情页上限50条；429限流标志为进程内状态；md5仅作UniqueID可换SHA；可能被CF拦(未验证)；未注册 |
| sdso | 未注册 | json-api | 8 / 60 | static-key-in-code | ua-header-only | S | H | AES-128-CBC密钥/IV硬编码，WebCrypto可解但需自行去PKCS7；页数ext可调(最多4×5=20页)；重试3次 |
| aikanzy | 未注册 | html | 16 / 100 | none | ua-header-only | M | M | 详情数无上限(取决于搜索页条数，估约15~20)，单请求带重试最多4次；需自行设上限(建议≤12)以控制子请求，并发限6 |

### C 级：需状态或子请求过多（15个）

| 插件 | 状态 | 类型 | 子请求 典型/最坏 | 认证 | 反爬 | 工作量 | 置信 | 要点 |
|---|---|---|---|---|---|---|---|---|
| ting77 | 已注册 | html | 17 / 33 | runtime-handshake | other | M | H | 每条链接需token+go两次请求，站点限流429，代码用内存窗口限制8次/65s且缓存link；Workers需KV存限流窗口和链接缓存，否则易被封，只能返回少量结果 |
| woniu | 已注册 | html | 20 / 50 | user-credentials | ua-header-only | L | H | 详情页需登录才有链接,无账号即报错;账号/Cookie落盘+管理页路由,需KV+登录接口重写;302手动处理 |
| btbtlb | 已注册 | html | 31 / 51 | none | ua-header-only | M | H | 三级扇出：1+10影片+最多40资源页=51，超免费50上限；可裁剪至每片2~3个资源降为B；(?i)正则需改写 |
| miosou | 已注册 | sse | 30 / 85 | runtime-handshake | other | L | M | 需在Worker内解Anubis PoW(difficulty≤7，SHA-256暴力循环，CPU时间风险)并持cookie；SSE解析；无直链的最多80条逐条请求detail，超限；站点可能封数据中心IP |
| libvio | 已注册 | html | 30 / 90 | runtime-handshake | other | L | M | 自建CDN PoW挑战(__cdn_pow→__cdn_verified,25分钟)需解题并存KV;详情+播放页二级扇出常>30;PoW循环或超CPU限制 |
| zxzj | 已注册 | html | 30 / 150 | none | ua-header-only | M | M | 搜索→详情→每集播放页取真实链接,集数多则很多,无上限;需截断 |
| sopanya | 已注册 | sse | 25 / 217 | runtime-handshake | ua-header-only | L | M | 候选≤24，非直链需POST save_url(站点代存)并最多轮询8次status，最坏217子请求且耗时长；SSE流式解析；可只保留直链候选做精简版 |
| dy4k | 已注册 | html | 40 / 300 | none | ua-header-only | M | M | 每条结果一次详情请求,无条数上限;页数≤10;子请求常>30,需截断页数/条数 |
| qiwei | 已注册 | mixed | 40 / 900 | runtime-handshake | custom-sign-or-encrypt | L | M | limit=100条各抓详情；滑块验证:取JS参数→md5(字符码+1)→GET换cookie，需维护 |
| panwiki | 未注册 | html | 34 / 46 | none | ua-header-only | L | M | 每页2请求×2页+每条详情(并发40)常>30；需redirect:manual读Location；默认未启用 |
| jupansou | 已注释停用 | sse | 15 / 60 | runtime-handshake | other | L | M | main.go已注释禁用；SSE需3秒截流；逐条POST /api/transfer换链，条数不定 |
| mikuclub | 未注册 | mixed | 25 / 60 | none | ua-header-only | M | M | 2次JSON搜索+每帖1次详情,无上限(估每类20~30帖);易超50子请求,建议只取前N帖 |
| panyq | 未注册 | mixed | 64 / 150 | runtime-handshake | custom-sign-or-encrypt | L | M | Action ID/凭证靠抓前端JS，改版即失效；每hit 2次POST共约60+；ID原存磁盘；main.go未注册 |
| haisou | 未注册 | json-api | 110 / 200 | none | ua-header-only | M | L | 每条结果需一次/fetch二次请求且无上限(每页条数未知，估约10~20条/页)，随便>30；不能并发超6；main.go未import该插件。可降为每类型1页并限制hsid数 |
| wuji | 未注册 | html | 100 / 450 | none | ua-header-only | M | M | 磁力仅在详情页input#input-magnet,每行一次请求,无上限;失败项丢弃;需截断 |

### D 级：不建议移植（10个）

| 插件 | 状态 | 类型 | 子请求 典型/最坏 | 认证 | 反爬 | 工作量 | 置信 | 要点 |
|---|---|---|---|---|---|---|---|---|
| huban | 已注册 | html | 13 / 25 | none | ua-header-only | L | H | 源站为裸IP:16969与xhban.xyz:20720，均http+非标端口，Workers无法访问；详情页数无上限 |
| xdpan | 已注册 | html | 11 / 40 | none | cloudflare-challenge | M | H | 代码自述aipanso.com已启用Cloudflare浏览器验证(cf-mitigated=challenge)，服务端请求无法通过，Workers数据中心IP同样会被拦 |
| diduan | 已注册 | html | 20 / 51 | none | cloudflare-challenge | L | H | ddys.io走CF Managed Challenge,代码靠cloudscraper;Workers出口IP基本被拦;详情页内atob(base64)需解码 |
| panlian | 已注册 | json-api | 41 / 90 | user-credentials | other | L | H | 需账号密码+验证码/邮箱确认登录，Cookie与AES加密密码落盘panlian_config.json，含管理网页路由；链接需逐条解锁且有每日额度 |
| gying | 已注册 | mixed | 21 / 300 | user-credentials | other | L | M | 需用户账号登录+cloudscraper/站点PoW浏览器验证页求解，cookie/配置落盘、管理Web路由；详情并发50、最多10用户。不建议移植 |
| qqpd | 已注册 | json-api | 5 / 500 | user-credentials | other | L | M | 依赖手机QQ扫码登录、Cookie落盘(AES加密)、Web管理页与保活任务；每用户×频道一次POST(≤10用户)，需大改为KV/D1，不建议移植 |
| weibo | 已注册 | json-api | 60 / 500 | user-credentials | other | L | H | 依赖用户扫码登录Cookie落盘(storage dir)+gin管理页/web路由；请求数随绑定用户数和评论翻页无上限；需整体改成KV/D1+登录流程。 |
| discourse | 未注册 | json-api | 1 / 10 | none | cloudflare-challenge | L | M | linux.do有CF挑战,Go用cloudscraper破解,Workers被拦;仅解析blurb;不建议移植 |
| erxiao | 已注释停用 | html | 14 / 50 | none | ua-header-only | S | M | main.go中该插件import已被注释(停用)，域名wexwp.cc/2xiaopan.top存活未验证；技术上同zhizhen(MacCMS)可直译，详情数无上限 |
| panzun | 未注册 | json-api | 45 / 200 | none | cloudflare-challenge | L | H | 全部API依赖cloudscraper过CF,Workers出口难过;另有每帖详情+每个a.7u9.cn短链跳转,子请求上百 |

## 7. 不建议移植的插件及原因

### D 级

- **huban**（已注册）：源站为裸IP:16969与xhban.xyz:20720，均http+非标端口，Workers无法访问；详情页数无上限
- **xdpan**（已注册）：代码自述aipanso.com已启用Cloudflare浏览器验证(cf-mitigated=challenge)，服务端请求无法通过，Workers数据中心IP同样会被拦
- **diduan**（已注册）：ddys.io走CF Managed Challenge,代码靠cloudscraper;Workers出口IP基本被拦;详情页内atob(base64)需解码
- **panlian**（已注册）：需账号密码+验证码/邮箱确认登录，Cookie与AES加密密码落盘panlian_config.json，含管理网页路由；链接需逐条解锁且有每日额度
- **gying**（已注册）：需用户账号登录+cloudscraper/站点PoW浏览器验证页求解，cookie/配置落盘、管理Web路由；详情并发50、最多10用户。不建议移植
- **qqpd**（已注册）：依赖手机QQ扫码登录、Cookie落盘(AES加密)、Web管理页与保活任务；每用户×频道一次POST(≤10用户)，需大改为KV/D1，不建议移植
- **weibo**（已注册）：依赖用户扫码登录Cookie落盘(storage dir)+gin管理页/web路由；请求数随绑定用户数和评论翻页无上限；需整体改成KV/D1+登录流程。
- **discourse**（未注册）：linux.do有CF挑战,Go用cloudscraper破解,Workers被拦;仅解析blurb;不建议移植
- **erxiao**（已注释停用）：main.go中该插件import已被注释(停用)，域名wexwp.cc/2xiaopan.top存活未验证；技术上同zhizhen(MacCMS)可直译，详情数无上限
- **panzun**（未注册）：全部API依赖cloudscraper过CF,Workers出口难过;另有每帖详情+每个a.7u9.cn短链跳转,子请求上百

### C 级

- **ting77**（已注册）：每条链接需token+go两次请求，站点限流429，代码用内存窗口限制8次/65s且缓存link；Workers需KV存限流窗口和链接缓存，否则易被封，只能返回少量结果
- **woniu**（已注册）：详情页需登录才有链接,无账号即报错;账号/Cookie落盘+管理页路由,需KV+登录接口重写;302手动处理
- **btbtlb**（已注册）：三级扇出：1+10影片+最多40资源页=51，超免费50上限；可裁剪至每片2~3个资源降为B；(?i)正则需改写
- **miosou**（已注册）：需在Worker内解Anubis PoW(difficulty≤7，SHA-256暴力循环，CPU时间风险)并持cookie；SSE解析；无直链的最多80条逐条请求detail，超限；站点可能封数据中心IP
- **libvio**（已注册）：自建CDN PoW挑战(__cdn_pow→__cdn_verified,25分钟)需解题并存KV;详情+播放页二级扇出常>30;PoW循环或超CPU限制
- **zxzj**（已注册）：搜索→详情→每集播放页取真实链接,集数多则很多,无上限;需截断
- **sopanya**（已注册）：候选≤24，非直链需POST save_url(站点代存)并最多轮询8次status，最坏217子请求且耗时长；SSE流式解析；可只保留直链候选做精简版
- **dy4k**（已注册）：每条结果一次详情请求,无条数上限;页数≤10;子请求常>30,需截断页数/条数
- **qiwei**（已注册）：limit=100条各抓详情；滑块验证:取JS参数→md5(字符码+1)→GET换cookie，需维护
- **panwiki**（未注册）：每页2请求×2页+每条详情(并发40)常>30；需redirect:manual读Location；默认未启用
- **jupansou**（已注释停用）：main.go已注释禁用；SSE需3秒截流；逐条POST /api/transfer换链，条数不定
- **mikuclub**（未注册）：2次JSON搜索+每帖1次详情,无上限(估每类20~30帖);易超50子请求,建议只取前N帖
- **panyq**（未注册）：Action ID/凭证靠抓前端JS，改版即失效；每hit 2次POST共约60+；ID原存磁盘；main.go未注册
- **haisou**（未注册）：每条结果需一次/fetch二次请求且无上限(每页条数未知，估约10~20条/页)，随便>30；不能并发超6；main.go未import该插件。可降为每类型1页并限制hsid数
- **wuji**（未注册）：磁力仅在详情页input#input-magnet,每行一次请求,无上限;失败项丢弃;需截断

## 8. 后续建议

1. 先实测：对阶段 1、2 入选插件，用一个本地 `wrangler dev` 脚本逐个请求，确认站点存活，并确认 Cloudflare 出口是否被拦。**这一步会淘汰一批插件**，比继续研究源码更值得。
2. 把每个插件的"详情页上限"做成配置项，而不是写死。
3. 评级里 B 级占多数且置信度多为 medium；开工每个插件时，再读一遍对应 Go 源码核实请求链，不要只依赖本报告的估算。
4. 可复用资产：原仓库 `plugin/*/` 下的 `html结构分析.md`、`json结构分析.md` 和部分 `testdata/` 固件，可直接当作 TS 单测的样本。
