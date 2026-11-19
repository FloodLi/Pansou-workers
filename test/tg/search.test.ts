// searchChannel 的 mock 测试。fixture 为 Go 仓库 util/testdata 的真实抓取页面。
import { describe, expect, it, vi } from 'vitest'
import { SubrequestBudget } from '../../src/core/budget'
import { HttpClient } from '../../src/core/http'
import { loadConfig } from '../../src/config'
import { TG_MAX_PAGES, buildSearchURL, searchChannel } from '../../src/tg/search'
import { fixture, mockFetch } from '../helpers/mockFetch'

const config = loadConfig({})
function setup(routes: Parameters<typeof mockFetch>[0], budget = 45) {
  const mock = mockFetch(routes)
  const http = new HttpClient(new SubrequestBudget(budget), mock.fetch).withTag('tg:shareAliyun')
  return { mock, http }
}

describe('buildSearchURL', () => {
  it('频道转义、关键词 QueryEscape、空关键词不带 q', () => {
    expect(buildSearchURL('shareAliyun', '仙逆 4K')).toBe('https://t.me/s/shareAliyun?q=%E4%BB%99%E9%80%86+4K')
    expect(buildSearchURL('a/b?c', 'x')).toBe('https://t.me/s/a%2Fb%3Fc?q=x')
    expect(buildSearchURL('ch', '')).toBe('https://t.me/s/ch')
    expect(buildSearchURL('ch', "a'b")).toBe('https://t.me/s/ch?q=a%27b')
  })
})

describe('searchChannel', () => {
  it('请求形态与解析结果', async () => {
    const { mock, http } = setup([{ match: 't.me/s/', respond: fixture('tg/tg_channel_shareAliyun_real.html') }])
    const r = await searchChannel('骄阳', 'shareAliyun', http, config)
    expect(r.length).toBe(20)
    expect(r[0]!.channel).toBe('shareAliyun')
    expect(mock.calls.length).toBe(TG_MAX_PAGES)
    expect(mock.calls[0]!.method).toBe('GET')
    expect(mock.calls[0]!.url).toBe('https://t.me/s/shareAliyun?q=%E9%AA%84%E9%98%B3')
    expect(mock.calls[0]!.headers['accept']).toContain('text/html')
  })

  it('无结果页返回 []', async () => {
    const html = '<div class="tgme_widget_message_wrap"><div class="tme_no_messages_found">No posts found</div></div>'
    const { http } = setup([{ match: 't.me/s/', respond: html }])
    expect(await searchChannel('x', 'shareAliyun', http, config)).toEqual([])
  })

  it('HTTP 500 抛错且只请求一次（无重试）', async () => {
    const { mock, http } = setup([{ match: 't.me/s/', respond: 'err', status: 500 }])
    await expect(searchChannel('x', 'shareAliyun', http, config)).rejects.toThrow(/500/)
    expect(mock.calls.length).toBe(1)
  })

  it('HTTP 403/404 抛错', async () => {
    const { http } = setup([{ match: 't.me/s/', respond: 'no', status: 404 }])
    await expect(searchChannel('x', 'shareAliyun', http, config)).rejects.toThrow(/404/)
  })

  it('页面结构变化：返回 [] 并告警，不抛错', async () => {
    const html = '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="ch/1"><div class="tgme_widget_message_text">x</div></div></div>'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { http } = setup([{ match: 't.me/s/', respond: html }])
    expect(await searchChannel('x', 'shareAliyun', http, config)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('响应体超过 3MB 抛错', async () => {
    const big = 'a'.repeat(3 * 1024 * 1024 + 10)
    const { http } = setup([{ match: 't.me/s/', respond: big }])
    await expect(searchChannel('x', 'shareAliyun', http, config)).rejects.toThrow(/上限/)
  })
})
