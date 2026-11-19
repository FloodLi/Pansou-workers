import { describe, expect, it } from 'vitest'
import { makeResult } from '../src/plugins/types'
import { mergeResultsByType } from '../src/search/mergeByType'
import { failure, success, ZERO_TIME } from '../src/types'

// 保证序列化字段名与顺序和原项目 Go 结构体 json tag 一致（客户端兼容）。
describe('响应结构与 Go 对齐', () => {
  it('SearchResult / Link 字段顺序', () => {
    const r = makeResult({ plugin: 'p', id: '1', title: 't', links: [{ url: 'https://pan.quark.cn/s/a', workTitle: 'w' }], tags: ['x'], images: ['i'] })
    expect(Object.keys(r)).toEqual(['message_id', 'unique_id', 'channel', 'datetime', 'title', 'content', 'links', 'tags', 'images'])
    expect(Object.keys(r.links[0]!)).toEqual(['type', 'url', 'password', 'datetime', 'work_title'])
  })
  it('无标签/图片/作品标题时省略（omitempty）', () => {
    const r = makeResult({ plugin: 'p', id: '1', title: 't', links: [{ url: 'https://pan.quark.cn/s/a' }] })
    expect('tags' in r).toBe(false)
    expect('images' in r).toBe(false)
    expect('work_title' in r.links[0]!).toBe(false)
    expect(r.datetime).toBe(ZERO_TIME)
  })
  it('MergedLink 字段顺序', () => {
    const r = makeResult({ plugin: 'p', id: '1', title: 't', datetime: '2025-01-01T00:00:00Z', links: [{ url: 'https://pan.quark.cn/s/a' }], images: ['i'] })
    const m = mergeResultsByType([r], 't', undefined, () => true)
    expect(Object.keys(m.quark![0]!)).toEqual(['url', 'password', 'note', 'datetime', 'source', 'images'])
  })
  it('成功/失败信封', () => {
    expect(success({ total: 0 })).toEqual({ code: 0, message: 'success', data: { total: 0 } })
    expect(failure(400, 'x')).toEqual({ code: 400, message: 'x' })
    expect('data' in failure(400, 'x')).toBe(false)
  })
})
