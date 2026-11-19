import { describe, expect, it } from 'vitest'
import { decodeJsString, extractArrayLiteral, extractJsonParseString, findStringEnd } from '../../src/plugins/_helpers/jsLiteral'
import { fields, hash16, pathEscape, queryEscape } from '../../src/plugins/_helpers/text'

describe('decodeJsString', () => {
  it('解码 \\x \\u 代理对 与引号反斜杠', () => {
    expect(decodeJsString("A\\x42\\u4ed9\\uD83D\\uDE00\\'\\\\\\/")).toBe("AB仙😀'\\/")
  })
  it('控制字符与行续接', () => {
    expect(decodeJsString('a\\nb\\tc\\\nd')).toBe('a\nb\tcd')
  })
  it('非法转义抛错', () => {
    expect(() => decodeJsString('\\u12')).toThrow()
    expect(() => decodeJsString('abc\\')).toThrow()
  })
})

describe('extractJsonParseString', () => {
  it('取单引号字符串并跳过被转义的引号', () => {
    const html = "<script>const list = JSON.parse('[{\"a\":\"it\\'s\"}]');var x = 'y'</script>"
    const s = extractJsonParseString(html, ["const list = JSON.parse('"])
    expect(JSON.parse(s as string)).toEqual([{ a: "it's" }])
  })
  it('备用 marker 与未命中', () => {
    expect(extractJsonParseString("let listItems = JSON.parse('[]')", ["const list = JSON.parse('", "let listItems = JSON.parse('"])).toBe('[]')
    expect(extractJsonParseString('nothing', ['x'])).toBeNull()
  })
  it('未闭合抛错', () => {
    expect(() => extractJsonParseString("const list = JSON.parse('[1,2", ["const list = JSON.parse('"])).toThrow()
  })
  it('反斜杠成对时引号视为结束', () => {
    expect(findStringEnd("ab\\\\'cd", 0, "'")).toBe(4)
    expect(findStringEnd("ab\\'cd'", 0, "'")).toBe(6)
  })
})

describe('extractArrayLiteral', () => {
  it('括号配对，字符串内的括号与引号不影响', () => {
    const t = 'const d = [{"a":"x]\\"[y"},[1,2],{"b":\'q]\'}]; var z = [9]'
    expect(extractArrayLiteral(t, 'const d = ')).toBe('[{"a":"x]\\"[y"},[1,2],{"b":\'q]\'}]')
  })
  it('marker 缺失返回 null；未闭合/缺数组抛错', () => {
    expect(extractArrayLiteral('abc', 'const d = ')).toBeNull()
    expect(() => extractArrayLiteral('const d = [1,[2]', 'const d = ')).toThrow()
    expect(() => extractArrayLiteral('const d = 5', 'const d = ')).toThrow()
  })
})

describe('text helpers', () => {
  it('pathEscape / queryEscape 与 Go 对齐', () => {
    expect(pathEscape('a b/c,d+e(1)')).toBe('a%20b%2Fc%2Cd+e%281%29')
    expect(queryEscape('a b&c')).toBe('a+b%26c')
    expect(pathEscape('仙逆')).toBe('%E4%BB%99%E9%80%86')
  })
  it('hash16 稳定且 16 位', () => {
    expect(hash16('a|b')).toBe(hash16('a|b'))
    expect(hash16('a|b')).not.toBe(hash16('a|c'))
    expect(hash16('x')).toMatch(/^[0-9a-f]{16}$/)
  })
  it('fields', () => {
    expect(fields('  a \n b\t')).toEqual(['a', 'b'])
  })
})
