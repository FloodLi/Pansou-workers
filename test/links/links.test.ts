// 转写自 Go util/parser_contract_test.go（TestExtractPasswordContract）、util/password_near_test.go，
// 并补充 Clean*/ExtractNetDiskLinks/isSupportedLink 等纯字符串函数的用例（期望值按 Go 实现逐行推演得出）。
// 依赖 goquery 的 HTML 解析用例（TestExtractTitleContract、TestMessageTextWithBreaksContract、
// TestParseSearchResultsStatus、parser_types_probe_test.go、parser_util_test.go、parser_real_*）已转写到 test/tg/parse.test.ts。
import { describe, expect, it } from 'vitest'
import {
  NETDISK_TITLE_PATTERNS,
  anchorCandidates,
  clean115PanURL,
  clean123PanURL,
  cleanAliyunPanURL,
  cleanBaiduPanURL,
  cleanLinkUrl,
  cleanMobilePanURL,
  cleanTianyiPanURL,
  cleanUCPanURL,
  extractCodeNear,
  extractNetDiskLinks,
  extractPassword,
  getLinkType,
  isSupportedLink,
  isValidPassword,
  normalize115PanURL,
  normalizeBaiduPanURL,
  normalizeUrl,
  normalizeURLForComparison,
  passwordFor,
  quoteMeta,
} from '../../src/links'

describe('extractPassword 契约（Go TestExtractPasswordContract）', () => {
  const cases: [string, string, string, string][] = [
    ['天翼云盘访问码（中文括号）', '', 'https://cloud.189.cn/t/abc（访问码：x7k9）', 'x7k9'],
    ['迅雷网盘pwd参数', '', 'https://pan.xunlei.com/s/VNabc?pwd=8f3q', '8f3q'],
    ['115网盘password参数', '', 'https://115.com/s/abc?password=9m2x', '9m2x'],
    ['123网盘URL编码提取码', '', 'https://www.123pan.com/s/abc?%E6%8F%90%E5%8F%96%E7%A0%81:ab12', 'ab12'],
    ['百度网盘pwd参数', '', 'https://pan.baidu.com/s/1abc?pwd=1234', '1234'],
  ]
  for (const [name, content, url, want] of cases) {
    it(name, () => expect(extractPassword(content, url)).toBe(want))
  }
})

const body =
  '百度网盘：https://pan.baidu.com/s/1AbCdEf 提取码：1234\n' +
  '天翼云盘：https://cloud.189.cn/t/xyzabc 访问码：abcd\n' +
  'UC网盘：https://drive.uc.cn/s/uc123 提取码：uc99\n' +
  '123网盘：https://www.123pan.com/s/pan123 提取码：p123\n' +
  '115网盘：https://115.com/s/abc115 访问码：p115\n' +
  '阿里云盘：https://www.aliyundrive.com/s/ali999'

describe('extractCodeNear（Go password_near_test.go）', () => {
  it('对照组：旧逻辑对六个链接一律返回首个码 1234', () => {
    const links = extractNetDiskLinks(body)
    expect(links.length).toBe(6)
    for (const l of links) expect(extractPassword(body, l)).toBe('1234')
  })

  it('每条链接拿到自己附近的码', () => {
    const want: Record<string, string> = {
      'https://pan.baidu.com/s/1AbCdEf': '1234',
      'https://cloud.189.cn/t/xyzabc': 'abcd',
      'https://drive.uc.cn/s/uc123': 'uc99',
      'https://123pan.com/s/pan123': 'p123',
      'https://115.com/s/abc115': 'p115',
      'https://www.aliyundrive.com/s/ali999': '',
    }
    for (const [url, pw] of Object.entries(want)) expect(extractCodeNear(url, body), url).toBe(pw)
  })

  it('提取码写在下一行也能取到', () => {
    const b = '链接：https://pan.baidu.com/s/1NextLine\n提取码：9xyz\n'
    expect(extractCodeNear('https://pan.baidu.com/s/1NextLine', b)).toBe('9xyz')
  })

  it('不越过下一个链接串码', () => {
    const b = 'https://pan.baidu.com/s/1First https://drive.uc.cn/s/ucSecond 提取码：abcd'
    expect(extractCodeNear('https://pan.baidu.com/s/1First', b)).toBe('')
    expect(extractCodeNear('https://drive.uc.cn/s/ucSecond', b)).toBe('abcd')
  })

  it('锚点被规范化（去 www./scheme）时仍能定位', () => {
    const b = '网盘：https://www.123pan.com/s/pan123 提取码：p123'
    for (const a of ['https://www.123pan.com/s/pan123', 'https://123pan.com/s/pan123', '123pan.com/s/pan123', '/s/pan123']) {
      expect(extractCodeNear(a, b), a).toBe('p123')
    }
  })

  it('长上下文定位不到锚点返回空', () => {
    const long = '这是一段很长的正文，提到很多别的东西。'.repeat(20) + '提取码：1234'
    expect(extractCodeNear('https://pan.baidu.com/s/1NotPresent', long)).toBe('')
  })

  it('passwordFor 附近取不到时回退整条扫描', () => {
    const b = '正文内容。'.repeat(30) + '\n全网盘列表：https://pan.baidu.com/s/1Far 提取码：7788'
    expect(passwordFor('https://pan.baidu.com/s/1Far', '另一个完全不同的短上下文', b)).toBe('7788')
    expect(passwordFor('https://www.alipan.com/s/btn', '按钮 提取码：bt01', b)).toBe('bt01')
  })

  it('窗口末尾不切出半个字符（返回值不含 U+FFFD）', () => {
    const b = '网盘：https://pan.baidu.com/s/1Rune 提取码' + '字'.repeat(40) + '：zz99'
    const got = extractCodeNear('https://pan.baidu.com/s/1Rune', b)
    expect(got.includes('\uFFFD')).toBe(false)
  })

  it('窗口按 UTF-8 字节计（60 字节）：超出窗口的提取码取不到', () => {
    // 锚后 " 提取码" 之前 17 个汉字 = 51 字节 + 空格，提取码+4位码超出 60 字节
    const b = 'https://pan.baidu.com/s/1Win ' + '字'.repeat(17) + '提取码：abcd'
    expect(extractCodeNear('https://pan.baidu.com/s/1Win', b)).toBe('')
    const b2 = 'https://pan.baidu.com/s/1Win ' + '字'.repeat(5) + '提取码：abcd'
    expect(extractCodeNear('https://pan.baidu.com/s/1Win', b2)).toBe('abcd')
  })

  it('anchorCandidates', () => {
    expect(anchorCandidates('https://www.123pan.com/s/pan123?pwd=abcd')).toEqual([
      'https://www.123pan.com/s/pan123',
      '123pan.com/s/pan123',
      'www.123pan.com/s/pan123',
      '/pan123',
    ])
    // 末段不超过 5 字节不作为候选
    expect(anchorCandidates('https://pan.baidu.com/s/abc/')).toEqual(['https://pan.baidu.com/s/abc', 'pan.baidu.com/s/abc'])
  })
})

describe('extractPassword 其它分支', () => {
  it('内容中"提取码："切分', () => {
    expect(extractPassword('链接 提取码：a1b2 谢谢', 'https://pan.quark.cn/s/abc')).toBe('a1b2')
    expect(extractPassword('提取码:ab12cdef', 'https://pan.quark.cn/s/abc')).toBe('ab12')
    expect(extractPassword('提取码:abcd🏷标签', 'https://x')).toBe('abcd')
    expect(extractPassword('提取码:abcd中文字符', 'https://x')).toBe('abcd')
    // 全角冒号：Go 按字节只跳 1 字节，切分分支必败，改由 PasswordPattern 要求恰好 4 位
    expect(extractPassword('提取码：abcd🏷标签', 'https://x')).toBe('abcd')
    expect(extractPassword('提取码：ab12cdef', 'https://x')).toBe('')
  })
  it('百度专用与通用模式', () => {
    expect(extractPassword('链接：https://pan.baidu.com/s/1a 密码：wxyz', 'https://pan.baidu.com/s/1a')).toBe('wxyz')
    expect(extractPassword('访问码：k3k3。', 'https://pan.quark.cn/s/abc')).toBe('k3k3')
    expect(extractPassword('pwd: ab12', 'https://pan.quark.cn/s/abc')).toBe('ab12')
    expect(extractPassword('没有码', 'https://pan.quark.cn/s/abc')).toBe('')
  })
  it('123 url 中的提取码（文本形式、带结束符）', () => {
    expect(extractPassword('', 'https://www.123pan.com/s/abc?提取码:ab12')).toBe('ab12')
    expect(extractPassword('', 'https://www.123pan.com/s/abc?提取码：ab12')).toBe('ab12')
  })
  it('isValidPassword', () => {
    expect(isValidPassword('aB09')).toBe(true)
    expect(isValidPassword('')).toBe(true)
    expect(isValidPassword('ab-1')).toBe(false)
    expect(isValidPassword('密码')).toBe(false)
  })
})

describe('Clean*PanURL', () => {
  it('百度：从前缀文本中取出并在 ?pwd= 处截断（Go 行为：pwd 被当结束标记丢弃）', () => {
    expect(cleanBaiduPanURL('前缀https://pan.baidu.com/s/1abc?pwd=1234 后文')).toBe('https://pan.baidu.com/s/1abc')
    expect(cleanBaiduPanURL('https://pan.baidu.com/s/1abc，其它')).toBe('https://pan.baidu.com/s/1abc')
    expect(cleanBaiduPanURL('http://pan.baidu.com/s/1abc')).toBe('http://pan.baidu.com/s/1abc')
  })
  it('天翼：截断并解码', () => {
    expect(cleanTianyiPanURL('https://cloud.189.cn/t/abc%EF%BC%88%E8%AE%BF%E9%97%AE%E7%A0%81%EF%BC%9Ax7k9%EF%BC%89')).toBe(
      'https://cloud.189.cn/t/abc（访问码：x7k9）',
    )
    expect(cleanTianyiPanURL('https://cloud.189.cn/t/abc实时更新')).toBe('https://cloud.189.cn/t/abc')
    expect(cleanTianyiPanURL('https://cloud.189.cn/t/abc%ZZ')).toBe('https://cloud.189.cn/t/abc%ZZ')
  })
  it('UC：分享码里的 123 不被当分隔符', () => {
    expect(cleanUCPanURL('https://drive.uc.cn/s/abc123')).toBe('https://drive.uc.cn/s/abc123')
    expect(cleanUCPanURL('https://drive.uc.cn/s/abc123?public=1')).toBe('https://drive.uc.cn/s/abc123?public=1')
    expect(cleanUCPanURL('https://drive.uc.cn/s/abc123?public=1 后')).toBe('https://drive.uc.cn/s/abc123?public=1')
    expect(cleanUCPanURL('https://drive.uc.cn/s/abc夸克')).toBe('https://drive.uc.cn/s/abc')
  })
  it('123：补协议头、去 www、编码提取码规范化、emoji 截断', () => {
    expect(clean123PanURL('123pan.com/s/xx')).toBe('https://123pan.com/s/xx')
    expect(clean123PanURL('链接https://www.123pan.com/s/abc')).toBe('https://123pan.com/s/abc')
    expect(clean123PanURL('https://123pan.com/s/abc')).toBe('https://123pan.com/s/abc')
    // 带协议头且 startIdx>0（www. 在域名前）时 Go 会丢掉 www.
    expect(clean123PanURL('https://www.123pan.com/s/abc?%E6%8F%90%E5%8F%96%E7%A0%81:ab12')).toBe('https://123pan.com/s/abc?提取码:ab12')
    expect(clean123PanURL('https://www.123pan.com/s/abc📁资源')).toBe('https://123pan.com/s/abc')
    expect(clean123PanURL('https://example.com/x')).toBe('https://example.com/x')
  })
  it('115', () => {
    expect(clean115PanURL('https://115.com/s/abc?password=9m2x后文')).toBe('https://115.com/s/abc?password=9m2x')
    expect(clean115PanURL('https://115.com/s/abc#')).toBe('https://115.com/s/abc')
    expect(clean115PanURL('115.com/s/abc')).toBe('https://115.com/s/abc')
    expect(clean115PanURL('x https://anxia.com/s/abc')).toBe('https://anxia.com/s/abc')
  })
  it('阿里', () => {
    expect(cleanAliyunPanURL('https://www.alipan.com/s/abc 提取码')).toBe('https://www.alipan.com/s/abc')
    expect(cleanAliyunPanURL('alipan.com/s/abc')).toBe('https://alipan.com/s/abc')
    expect(cleanAliyunPanURL('链接https://www.aliyundrive.com/s/abc标签')).toBe('https://www.aliyundrive.com/s/abc')
    expect(cleanAliyunPanURL('https://other.com/s/x')).toBe('https://other.com/s/x')
  })
  it('移动', () => {
    expect(cleanMobilePanURL('https://caiyun.139.com/w/i/2abc 提取码')).toBe('https://caiyun.139.com/w/i/2abc')
    expect(cleanMobilePanURL('文https://yun.139.com/shareweb/#/w/i/xyz访问码：1')).toBe('https://yun.139.com/shareweb/#/w/i/xyz')
    expect(cleanMobilePanURL('https://other.com')).toBe('https://other.com')
  })
  it('cleanLinkUrl 按类型分派', () => {
    expect(cleanLinkUrl('  https://pan.quark.cn/s/abc  ')).toBe('https://pan.quark.cn/s/abc')
    expect(cleanLinkUrl('说https://pan.baidu.com/s/1a?pwd=1234')).toBe('https://pan.baidu.com/s/1a')
    expect(cleanLinkUrl('https://115.com/s/abc#', '115')).toBe('https://115.com/s/abc')
  })
  it('normalize*', () => {
    expect(normalizeBaiduPanURL('https://pan.baidu.com/s/1a', 'abcdef')).toBe('https://pan.baidu.com/s/1a?pwd=abcd')
    expect(normalizeBaiduPanURL('https://pan.baidu.com/s/1a', '')).toBe('https://pan.baidu.com/s/1a')
    // Clean 已在 ?pwd= 处截断，所以原 pwd 丢失、以传入密码为准（Go 行为）
    expect(normalizeBaiduPanURL('https://pan.baidu.com/s/1a?pwd=1234', 'zzzz')).toBe('https://pan.baidu.com/s/1a?pwd=zzzz')
    expect(normalize115PanURL('115.com/s/abc#', '')).toBe('https://115.com/s/abc')
    expect(normalizeUrl('https://cloud.189.cn/t/a%E4%B8%AD')).toBe('https://cloud.189.cn/t/a中')
    expect(normalizeUrl('a+b%')).toBe('a+b%')
    expect(normalizeUrl('a+b')).toBe('a b')
  })
})

describe('extractNetDiskLinks / isSupportedLink', () => {
  it('各类型提取', () => {
    const text = [
      'https://pan.baidu.com/s/1AbC_d-e?pwd=ab12 提取码',
      'https://pan.quark.cn/s/92f07db5654b',
      'https://pan.xunlei.com/s/VP-EzzPFb8z7tideTMh-U-WTA1?pwd=vuiy#',
      'https://www.alipan.com/s/abc123',
      'https://guangyapan.com/s/abc-123',
      'https://caiyun.139.com/w/i/abc123',
      'magnet:?xt=urn:btih:ABCDEF0123456789',
      'ed2k://|file|a.mkv|123|ABCDEF0123|/',
      'https://mypikpak.com/s/xyz',
    ].join('\n')
    const got = extractNetDiskLinks(text)
    expect(got).toEqual([
      'https://pan.baidu.com/s/1AbC_d-e',
      'https://www.alipan.com/s/abc123',
      'https://guangyapan.com/s/abc-123',
      'https://caiyun.139.com/w/i/abc123',
      'https://pan.quark.cn/s/92f07db5654b',
      'https://pan.xunlei.com/s/VP', // Go 的迅雷正则不含 -，到连字符截断（忠实移植）
      'magnet:?xt=urn:btih:ABCDEF0123456789',
      'ed2k://|file|a.mkv|123|ABCDEF0123|/',
      'https://mypikpak.com/s/xyz',
    ])
  })
  it('六链接 fixture 正文', () => {
    expect(extractNetDiskLinks(body)).toEqual([
      'https://pan.baidu.com/s/1AbCdEf',
      'https://cloud.189.cn/t/xyzabc',
      'https://drive.uc.cn/s/uc123',
      'https://123pan.com/s/pan123',
      'https://115.com/s/abc115',
      'https://www.aliyundrive.com/s/ali999',
    ])
  })
  it('百度/天翼/UC 不去重，其余类型去重', () => {
    expect(extractNetDiskLinks('https://pan.baidu.com/s/1a https://pan.baidu.com/s/1a')).toHaveLength(2)
    expect(extractNetDiskLinks('https://pan.quark.cn/s/ab https://pan.quark.cn/s/ab')).toHaveLength(1)
    expect(extractNetDiskLinks('https://www.alipan.com/s/ab http://www.alipan.com/s/ab')).toHaveLength(1)
  })
  it('空文本', () => expect(extractNetDiskLinks('没有链接')).toEqual([]))
  it('长文本保持线性（粗略计时）', () => {
    const big = ('这是一些无关文字 https://pan.quark.cn/s/abc 提取码：1234\n'.repeat(1) + 'a'.repeat(50)).repeat(300)
    const t0 = performance.now()
    extractNetDiskLinks(big)
    expect(performance.now() - t0).toBeLessThan(500)
  })
  it('isSupportedLink（先转小写）', () => {
    expect(isSupportedLink('HTTPS://PAN.BAIDU.COM/S/1abc')).toBe(true)
    expect(isSupportedLink('https://example.com/s/1abc')).toBe(false)
    expect(isSupportedLink('magnet:?xt=urn:btih:abc123')).toBe(true)
  })
  it('normalizeURLForComparison', () => {
    expect(normalizeURLForComparison('https://www.123pan.com/s/a?%E6%8F%90%E5%8F%96%E7%A0%81:ab12')).toBe('www.123pan.com/s/a?提取码:ab12')
  })
  it('quoteMeta / getLinkType 未改变', () => {
    expect(quoteMeta('a.b*c(d)[e]')).toBe('a\\.b\\*c\\(d\\)\\[e\\]')
    expect(getLinkType('https://pan.quark.cn/s/x')).toBe('quark')
  })
  it('NETDISK_TITLE_PATTERNS 带 g 且顺序固定', () => {
    expect(NETDISK_TITLE_PATTERNS).toHaveLength(9)
    for (const re of NETDISK_TITLE_PATTERNS) expect(re.global).toBe(true)
    const text = 'https://cloud.189.cn/t/abc https://pan.baidu.com/s/1a'
    expect(text.match(NETDISK_TITLE_PATTERNS[0]!)).toEqual(['https://cloud.189.cn/t/abc'])
    expect(text.match(NETDISK_TITLE_PATTERNS[0]!)).toEqual(['https://cloud.189.cn/t/abc'])
    expect(text.match(NETDISK_TITLE_PATTERNS[1]!)).toEqual(['https://pan.baidu.com/s/1a'])
  })
})
