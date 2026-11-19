import { describe, expect, it } from 'vitest'
import { BudgetExceeded, SubrequestBudget } from '../../src/core/budget'
import { HttpClient, HttpError } from '../../src/core/http'
import { fulfilled, mapLimit } from '../../src/core/pool'
import { parseTime, isZeroTime } from '../../src/core/time'
import { unescapeHtml } from '../../src/core/html'
import { ZERO_TIME } from '../../src/types'
import { mockFetch } from '../helpers/mockFetch'

describe('SubrequestBudget', () => {
  it('超限抛 BudgetExceeded', () => {
    const b = new SubrequestBudget(2)
    b.take()
    b.take()
    expect(() => b.take()).toThrow(BudgetExceeded)
    expect(b.usedCount).toBe(2)
  })
})

describe('HttpClient', () => {
  it('成功请求扣 1 次预算', async () => {
    const m = mockFetch([{ match: 'a.test', respond: 'hello' }])
    const b = new SubrequestBudget(5)
    const c = new HttpClient(b, m.fetch)
    expect(await c.text('https://a.test/')).toBe('hello')
    expect(b.usedCount).toBe(1)
  })

  it('5xx 会重试，且每次尝试都扣预算', async () => {
    let n = 0
    const m = mockFetch([{ match: 'a.test', respond: () => (++n < 3 ? new Response('x', { status: 503 }) : 'ok') }])
    const b = new SubrequestBudget(10)
    const c = new HttpClient(b, m.fetch)
    expect(await c.text('https://a.test/', { retries: 2 })).toBe('ok')
    expect(b.usedCount).toBe(3)
  })

  it('4xx 不重试，text() 抛 HttpError', async () => {
    const m = mockFetch([{ match: 'a.test', respond: 'nope', status: 404 }])
    const b = new SubrequestBudget(10)
    const c = new HttpClient(b, m.fetch).withTag('demo')
    await expect(c.text('https://a.test/', { retries: 3 })).rejects.toThrow(HttpError)
    expect(b.usedCount).toBe(1)
  })

  it('预算耗尽时不再发请求', async () => {
    const m = mockFetch([{ match: 'a.test', respond: 'x', status: 500 }])
    const c = new HttpClient(new SubrequestBudget(2), m.fetch)
    await expect(c.text('https://a.test/', { retries: 5 })).rejects.toThrow(BudgetExceeded)
    expect(m.calls.length).toBe(2)
  })

  it('响应体超过上限报错', async () => {
    const m = mockFetch([{ match: 'a.test', respond: 'x'.repeat(100) }])
    const c = new HttpClient(new SubrequestBudget(5), m.fetch)
    await expect(c.text('https://a.test/', { maxBytes: 10, retries: 0 })).rejects.toThrow(/超过上限/)
  })

  it('json() 解析失败给出带前缀的错误', async () => {
    const m = mockFetch([{ match: 'a.test', respond: 'not json' }])
    const c = new HttpClient(new SubrequestBudget(5), m.fetch).withTag('demo')
    await expect(c.json('https://a.test/')).rejects.toThrow('[demo]')
  })
})

describe('mapLimit', () => {
  it('并发峰值不超过上限，保持顺序', async () => {
    let cur = 0
    let peak = 0
    const res = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      cur++
      peak = Math.max(peak, cur)
      await new Promise((r) => setTimeout(r, 5))
      cur--
      return n * 2
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(fulfilled(res)).toEqual([2, 4, 6, 8, 10, 12, 14, 16])
  })

  it('单个失败不影响其他', async () => {
    const res = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(fulfilled(res)).toEqual([1, 3])
    expect(res[1]?.status).toBe('rejected')
  })
})

describe('parseTime', () => {
  it('无时区按 UTC（与原项目一致）', () => {
    expect(parseTime('2024-05-01 12:00:00')).toBe('2024-05-01T12:00:00Z')
    expect(parseTime('2024年5月1日')).toBe('2024-05-01T00:00:00Z')
    expect(parseTime('2024-05-01')).toBe('2024-05-01T00:00:00Z')
  })
  it('RFC3339 与 epoch', () => {
    expect(parseTime('2024-05-01T12:00:00+08:00')).toBe('2024-05-01T04:00:00Z')
    expect(parseTime(1714536000)).toBe('2024-05-01T04:00:00Z')
    expect(parseTime('1714536000000')).toBe('2024-05-01T04:00:00Z')
  })
  it('无法解析返回零值', () => {
    expect(parseTime('')).toBe(ZERO_TIME)
    expect(parseTime('刚刚')).toBe(ZERO_TIME)
    expect(isZeroTime(parseTime(undefined))).toBe(true)
  })
})

describe('unescapeHtml', () => {
  it('常用与数字实体', () => {
    expect(unescapeHtml('a&amp;b &lt;x&gt; &#39;q&#39; &#x4e2d;')).toBe("a&b <x> 'q' 中")
    expect(unescapeHtml('&unknown;')).toBe('&unknown;')
  })
})
