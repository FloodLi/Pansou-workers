// 移植自 util/parser_util.go 的 TG 页面解析（ParseSearchResultsWithStatus 及其 helper）。
import { parseHtml, type HTMLElement } from '../core/html'
import { parseTime } from '../core/time'
import {
  getLinkType,
  isSupportedLink,
  normalizeUrl,
  passwordFor,
  extractNetDiskLinks,
  cleanTianyiPanURL,
  cleanUCPanURL,
  clean123PanURL,
  clean115PanURL,
  cleanAliyunPanURL,
  normalizeBaiduPanURL,
  normalizeTianyiPanURL,
  normalizeUCPanURL,
  normalize123PanURL,
  normalize115PanURL,
} from '../links'
import { cutTitleByKeywords } from '../search/titles'
import { ZERO_TIME, type Link, type SearchResult } from '../types'

export const ParseStatus = {
  OK: 'ok',
  /** 页面明确给出无结果标记，0 条是可信结果 */
  NoMessages: 'no_messages',
  /** 页面含消息块却一条都识别不出，通常是页面结构已变 */
  StructureChanged: 'structure_changed',
} as const
export type PageParseStatus = (typeof ParseStatus)[keyof typeof ParseStatus]

const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const DATE_HEADER_RE = /^📅?\s*\d{1,4}(?:年\d{1,2}月\d{1,2}日|[-/.]\d{1,2}[-/.]\d{1,2})$|^📅?\s*\d{1,2}月\d{1,2}日$/u
const TITLE_META_PREFIXES = ['类型：', '分享：', '网盘：', '简介：', '描述：', '更多资源：']
const TITLE_CUT_KEYWORDS = ['简介', '描述']
const NETDISK_NAMES = [
  '夸克网盘', '夸克云盘', '夸克',
  '百度网盘', '百度云盘', '百度云', '百度',
  '迅雷网盘', '迅雷云盘', '迅雷',
  '阿里云盘', '阿里网盘', '阿里云', '阿里',
  '天翼云盘', '天翼网盘', '天翼云', '天翼',
  'UC网盘', 'UC云盘', 'UC',
  '移动云盘', '移动云', '移动',
  '115网盘', '115云盘', '115',
  '123网盘', '123云盘', '123',
  'PikPak网盘', 'PikPak',
  '网盘', '云盘',
]

export interface ParsedPage {
  results: SearchResult[]
  status: PageParseStatus
}

// ---- 文本投影（goquery 的 Text() 与 messageTextWithBreaks 的等价物） ----

/**
 * 纯文本：只拼文本节点，不把 <br> 当换行。
 * 不能用 node-html-parser 的 .text——它会把 <br> 变成换行，与 goquery 的 Text() 不同。
 */
export function textContent(el: HTMLElement | null | undefined): string {
  if (!el) return ''
  let out = ''
  const walk = (n: HTMLElement): void => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.text
      else if (c.nodeType === 1) walk(c as HTMLElement)
    }
  }
  walk(el)
  return out
}

/** 带换行的正文：<br> 记为换行，注释丢弃（解析器本身不保留注释节点），其它元素取子文本。 */
export function messageTextWithBreaks(el: HTMLElement | null | undefined): string {
  if (!el) return ''
  let out = ''
  const walk = (n: HTMLElement): void => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) {
        out += c.text
      } else if (c.nodeType === 1) {
        const e = c as HTMLElement
        if (e.rawTagName.toLowerCase() === 'br') out += '\n'
        else walk(e)
      }
    }
  }
  walk(el)
  return out
}

// ---- 标题 ----

export function isTelegramDateHeader(line: string): boolean {
  return DATE_HEADER_RE.test(line.trim())
}

export function isTitleMetadataLine(line: string): boolean {
  const l = line.trim()
  return TITLE_META_PREFIXES.some((p) => l.startsWith(p))
}

const NAME_PREFIX = '名称：'

export function extractTitle(textWithBreaks: string, textContentStr: string): string {
  // 部分频道首行是日期头，真正作品名在下一行，需跳过
  if (textWithBreaks !== '') {
    for (const raw of textWithBreaks.split('\n')) {
      const line = raw.trim()
      if (line === '' || isTelegramDateHeader(line) || isTitleMetadataLine(line)) continue
      if (line.startsWith(NAME_PREFIX)) return line.slice(NAME_PREFIX.length).trim()
      if (line.startsWith('#') && !line.includes('名称')) continue
      return cutTitleByKeywords(line, TITLE_CUT_KEYWORDS)
    }
  }

  // 正文为空时回落到纯文本内容
  const lines = textContentStr.split('\n')
  const firstLine = (lines[0] ?? '').trim()

  if (firstLine.startsWith('#')) {
    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith(NAME_PREFIX)) return line.slice(NAME_PREFIX.length).trim()
    }
    if (lines.length > 1) {
      const second = (lines[1] ?? '').trim()
      if (second.startsWith(NAME_PREFIX)) return second.slice(NAME_PREFIX.length).trim()
      if (second !== '' && !second.startsWith('#')) return cutTitleByKeywords(second, TITLE_CUT_KEYWORDS)
    }
  }

  if (firstLine.startsWith(NAME_PREFIX)) return firstLine.slice(NAME_PREFIX.length).trim()
  return cutTitleByKeywords(firstLine, TITLE_CUT_KEYWORDS)
}

// ---- 链接收集 ----

type Normalizer = (baseUrl: string, password: string) => string

/** 对应 Go linkCandidates：direct 保持出现顺序，byType 等整条消息扫完再补密码。 */
class LinkCandidates {
  private direct: Link[] = []
  private found = new Set<string>()
  private byType = new Map<string, Map<string, string>>()

  add(linkType: string, rawUrl: string, password: string): void {
    let byType = this.byType.get(linkType)
    if (!byType) {
      byType = new Map()
      this.byType.set(linkType, byType)
    }
    switch (linkType) {
      case 'baidu': {
        // 百度链接要剥掉 ?pwd= 参数：密码单独存，最后再拼回
        const i = rawUrl.indexOf('?pwd=')
        this.setPassword(byType, i >= 0 ? rawUrl.slice(0, i) : rawUrl, password)
        break
      }
      case 'tianyi':
        this.setPassword(byType, cleanTianyiPanURL(rawUrl), password)
        break
      case 'uc':
        this.setPassword(byType, cleanUCPanURL(rawUrl), password)
        break
      case '123':
        this.setPassword(byType, clean123PanURL(rawUrl), password)
        break
      case '115':
        this.setPassword(byType, clean115PanURL(rawUrl), password)
        break
      case 'aliyun':
        this.setPassword(byType, cleanAliyunPanURL(rawUrl), password)
        break
      default: {
        const href = normalizeUrl(rawUrl)
        if (!this.found.has(href)) {
          this.found.add(href)
          this.direct.push({ type: linkType, url: href, password, datetime: ZERO_TIME })
        }
      }
    }
  }

  private setPassword(byType: Map<string, string>, baseUrl: string, password: string): void {
    if (password !== '') byType.set(baseUrl, password)
    else if (!byType.has(baseUrl)) byType.set(baseUrl, '')
  }

  finalize(): Link[] {
    const links = this.direct
    const specs: Array<[string, Normalizer]> = [
      ['baidu', normalizeBaiduPanURL],
      ['tianyi', normalizeTianyiPanURL],
      ['uc', normalizeUCPanURL],
      ['123', normalize123PanURL],
      ['115', normalize115PanURL],
      // 阿里云盘 URL 通常不含密码参数
      ['aliyun', (u) => cleanAliyunPanURL(u)],
    ]
    for (const [typ, normalize] of specs) {
      const m = this.byType.get(typ)
      if (!m) continue
      for (const [baseUrl, password] of m) {
        const url = normalize(baseUrl, password)
        if (!this.found.has(url)) {
          this.found.add(url)
          links.push({ type: typ, url, password, datetime: ZERO_TIME })
        }
      }
    }
    return links
  }
}

function collectMessageLinks(scope: HTMLElement, messageText: string, textWithBreaks: string): Link[] {
  const cand = new LinkCandidates()

  // 正文 <a> 与行内键盘按钮 <a href>（键盘与正文同级，不能只扫正文）
  for (const a of scope.querySelectorAll('.tgme_widget_message_text a, .tgme_widget_message_inline_keyboard a[href]')) {
    const href = a.getAttribute('href')
    if (href === undefined || !isSupportedLink(href)) continue
    // 部分频道把提取码写在按钮文字里，所以同时用正文和按钮标签做上下文
    const buttonText = textContent(a).trim()
    const passwordContext = buttonText ? `${messageText}\n${buttonText}` : messageText
    cand.add(getLinkType(href), href, passwordFor(href, `${buttonText}\n${textWithBreaks}`, passwordContext))
  }

  // 正文里直接写出的裸链接；主上下文用带换行的正文，才能按锚定位取码
  for (const url of extractNetDiskLinks(messageText)) {
    cand.add(getLinkType(url), url, passwordFor(url, textWithBreaks, messageText))
  }
  return cand.finalize()
}

// ---- 标签 / 图片 ----

function extractMessageTags(textEl: HTMLElement | null): string[] {
  const tags: string[] = []
  if (!textEl) return tags
  for (const a of textEl.querySelectorAll("a[href^='?q=%23']")) {
    const tag = textContent(a)
    if (tag.startsWith('#')) tags.push(tag.slice(1))
  }
  return tags
}

export function extractImageURLFromStyle(style: string): string {
  const tries: Array<[string, string]> = [
    ["background-image:url('", "')"],
    ['background-image:url("', '")'],
    ['background-image:url(', ')'],
  ]
  for (const [start, end] of tries) {
    const si = style.indexOf(start)
    if (si === -1) continue
    const from = si + start.length
    const ei = style.indexOf(end, from)
    if (ei === -1) continue
    const v = style.slice(from, ei)
    // 无引号格式可能残留引号
    return start.endsWith('(') ? v.replace(/^['"]+|['"]+$/g, '') : v
  }
  return ''
}

function extractMessageImages(messageDiv: HTMLElement): string[] {
  const images: string[] = []
  const seen = new Set<string>()
  // 只扫消息气泡，排除用户头像
  for (const bubble of messageDiv.querySelectorAll('.tgme_widget_message_bubble')) {
    for (const wrap of bubble.querySelectorAll('.tgme_widget_message_photo_wrap')) {
      const style = wrap.getAttribute('style')
      if (style === undefined) continue
      const u = extractImageURLFromStyle(style)
      if (u !== '' && !seen.has(u)) {
        seen.add(u)
        images.push(u)
      }
    }
  }
  for (const bubble of messageDiv.querySelectorAll('.tgme_widget_message_bubble')) {
    for (const img of bubble.querySelectorAll('img')) {
      const src = img.getAttribute('src')
      if (src && !seen.has(src)) {
        seen.add(src)
        images.push(src)
      }
    }
  }
  return images
}

// ---- 作品标题 ----

function extractFirstURL(text: string): string {
  let end = text.length
  for (const sep of [' ', '\n', '\r']) {
    const i = text.indexOf(sep)
    if (i > 0 && i < end) end = i
  }
  return text.slice(0, end).trim()
}

function extractWorkTitleBeforeColon(input: string): string {
  let text = input.trim()
  for (const name of NETDISK_NAMES) {
    if (text.endsWith(name)) {
      text = text.slice(0, text.length - name.length).trim()
      break
    }
  }
  return text
}

function isSingleLineFormat(lines: string[]): boolean {
  let count = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (line.includes('丨') && line.includes('：') && (line.includes('http://') || line.includes('https://'))) count++
  }
  return count > Math.floor(lines.length / 3)
}

function workTitlesFromSingleLine(links: Link[], lines: string[], defaultTitle: string): Link[] {
  const map = new Map<string, string>()
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    let workTitle = ''
    let linkUrl = ''
    if (line.includes('丨')) {
      const parts = line.split('丨')
      if (parts.length >= 2) {
        workTitle = (parts[0] ?? '').trim()
        const rest = parts[1] ?? ''
        const idx = rest.indexOf('http')
        if (idx >= 0) linkUrl = extractFirstURL(rest.slice(idx))
      }
    } else if (line.includes('：')) {
      const ci = line.indexOf('：')
      if (ci > 0) {
        workTitle = extractWorkTitleBeforeColon(line.slice(0, ci))
        const after = line.slice(ci + 1)
        const idx = after.indexOf('http')
        if (idx >= 0) linkUrl = extractFirstURL(after.slice(idx))
      }
    }
    if (workTitle !== '' && linkUrl !== '') map.set(normalizeUrl(linkUrl), workTitle)
  }
  for (const l of links) l.work_title = map.get(normalizeUrl(l.url)) ?? defaultTitle
  return links
}

function extractWorkTitlesForLinks(links: Link[], messageText: string, defaultTitle: string): Link[] {
  if (links.length === 0) return links
  // <=4 条视为同一作品的不同网盘；>4 条才尝试逐条匹配
  if (links.length <= 4) {
    for (const l of links) l.work_title = defaultTitle
    return links
  }
  const lines = messageText.split('\n')
  if (isSingleLineFormat(lines)) return workTitlesFromSingleLine(links, lines, defaultTitle)
  // Go 的 extractWorkTitlesFromContext 也只是统一用默认标题
  for (const l of links) l.work_title = defaultTitle
  return links
}

// ---- 消息与页面 ----

/** 返回 [结果, ok(能识别为消息), hasResult] 的等价结构；result 为 null 表示无结果。 */
function parseTgMessage(wrap: HTMLElement, channel: string): { ok: boolean; result: SearchResult | null } {
  const messageDiv = wrap.querySelector('.tgme_widget_message')
  if (!messageDiv) return { ok: false, result: null }

  const dataPost = messageDiv.getAttribute('data-post')
  if (dataPost === undefined) return { ok: false, result: null }
  const parts = dataPost.split('/')
  if (parts.length !== 2) return { ok: false, result: null }
  const messageId = parts[1] ?? ''
  const uniqueId = `${channel}_${messageId}`

  const timeStr = messageDiv.querySelector('.tgme_widget_message_date time')?.getAttribute('datetime')
  if (timeStr === undefined || !RFC3339_RE.test(timeStr)) return { ok: false, result: null }
  const datetime = parseTime(timeStr)
  if (datetime === ZERO_TIME) return { ok: false, result: null }

  const textEl = messageDiv.querySelector('.tgme_widget_message_text')
  const textWithBreaks = messageTextWithBreaks(textEl)
  const messageText = textContent(textEl)
  const title = extractTitle(textWithBreaks, messageText)

  const links = collectMessageLinks(wrap, messageText, textWithBreaks)
  // 只有含链接的消息才进入结果
  if (links.length === 0) return { ok: true, result: null }

  const tags = extractMessageTags(textEl)
  const images = extractMessageImages(messageDiv)
  return {
    ok: true,
    result: {
      message_id: messageId,
      unique_id: uniqueId,
      channel,
      datetime,
      title,
      content: messageText,
      links: extractWorkTitlesForLinks(links, messageText, title),
      tags,
      images,
    },
  }
}

/** 对应 ParseSearchResultsWithStatus：额外返回解析可信度，区分"频道没内容"与"解析失效"。 */
export function parseSearchResultsWithStatus(html: string, channel: string): ParsedPage {
  const doc = parseHtml(html)
  const wraps = doc.querySelectorAll('.tgme_widget_message_wrap')
  const results: SearchResult[] = []
  let recognized = 0
  for (const wrap of wraps) {
    const { ok, result } = parseTgMessage(wrap, channel)
    if (!ok) continue
    recognized++
    if (result) results.push(result)
  }
  return { results, status: judgeParseStatus(doc, wraps.length, recognized, results.length) }
}

export function parseSearchResults(html: string, channel: string): SearchResult[] {
  return parseSearchResultsWithStatus(html, channel).results
}

/** 不能用 0 条结果判失效：消息识别成功但无网盘链接时同样是 0 条，那是正常页面。 */
function judgeParseStatus(doc: HTMLElement, wrapCount: number, recognized: number, resultCount: number): PageParseStatus {
  if (resultCount !== 0) return ParseStatus.OK
  if (doc.querySelector('.tme_no_messages_found')) return ParseStatus.NoMessages
  if (recognized === 0 && wrapCount > 0) return ParseStatus.StructureChanged
  return ParseStatus.OK
}
