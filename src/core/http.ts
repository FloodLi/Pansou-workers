import { SubrequestBudget } from './budget'

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 默认单个响应体上限（对应原项目 MaxUpstreamResponseBytes 的量级）。 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | URLSearchParams
  /** 单次尝试超时（毫秒），默认 8000 */
  timeoutMs?: number
  /** 响应体大小上限，超出抛错 */
  maxBytes?: number
  redirect?: 'follow' | 'manual'
  /** 额外重试次数（不含首次），默认 1；每次尝试都会扣预算 */
  retries?: number
  /** 响应体解码字符集，默认 utf-8 */
  charset?: string
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface HttpResponse {
  status: number
  headers: Headers
  text: string
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 带预算、超时、重试、体积上限的 fetch 封装。插件只能通过它出站，
 * 这样子请求总数才可控。
 */
export class HttpClient {
  constructor(
    private readonly budget: SubrequestBudget,
    private readonly fetchImpl: FetchFn = (u, i) => fetch(u, i),
    private readonly tag = '',
  ) {}

  /** 返回绑定了错误前缀（插件名）的客户端，共用同一份预算。 */
  withTag(tag: string): HttpClient {
    return new HttpClient(this.budget, this.fetchImpl, tag)
  }

  async request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const retries = opts.retries ?? 1
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.budget.take() // 预算耗尽直接抛 BudgetExceeded，不重试
      try {
        const res = await this.once(url, opts)
        if (res.status >= 500 || res.status === 429) {
          lastErr = new HttpError(res.status, this.msg(`HTTP ${res.status}`))
        } else {
          return res
        }
      } catch (e) {
        lastErr = e
      }
      if (attempt < retries) await sleep(200 * (attempt + 1))
    }
    throw lastErr instanceof Error ? lastErr : new Error(this.msg(String(lastErr)))
  }

  /** 要求 2xx，返回文本。 */
  async text(url: string, opts: RequestOptions = {}): Promise<string> {
    const res = await this.request(url, opts)
    if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, this.msg(`HTTP ${res.status}`))
    return res.text
  }

  async json<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
    const body = await this.text(url, opts)
    try {
      return JSON.parse(body) as T
    } catch {
      throw new Error(this.msg('响应不是合法 JSON'))
    }
  }

  private async once(url: string, opts: RequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = { 'User-Agent': DEFAULT_UA, ...opts.headers }
    let body: BodyInit | undefined
    if (opts.body instanceof URLSearchParams) {
      body = opts.body
    } else if (typeof opts.body === 'string') {
      body = opts.body
    }
    const res = await this.fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers,
      body,
      redirect: opts.redirect ?? 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })
    const text = await readLimited(res, opts.maxBytes ?? MAX_BODY_BYTES, opts.charset ?? 'utf-8', this.tag)
    return { status: res.status, headers: res.headers, text }
  }

  private msg(m: string): string {
    return this.tag ? `[${this.tag}] ${m}` : m
  }
}

/** 流式读取响应体，超过上限即报错（对应原项目 ReadAllLimited）。 */
export async function readLimited(res: Response, maxBytes: number, charset: string, tag = ''): Promise<string> {
  const prefix = tag ? `[${tag}] ` : ''
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`${prefix}响应体超过上限 ${maxBytes} 字节`)
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder(charset).decode(buf)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 把任意 Error 压成一行，用于日志与失败标记。 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
