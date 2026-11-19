// 转写自 Go util/parser_contract_test.go、parser_types_probe_test.go、parser_util_test.go、
// parser_real_fixture_test.go、parser_real_codes_fixture_test.go。
// test/fixtures/tg/*.html 是 Go 仓库 util/testdata 下的真实抓取页面（原样复制）；
// 其余内联 HTML 与 Go 用例相同。
import { describe, expect, it } from 'vitest'
import { parseHtml } from '../../src/core/html'
import {
  ParseStatus,
  extractTitle,
  messageTextWithBreaks,
  parseSearchResults,
  parseSearchResultsWithStatus,
  textContent,
} from '../../src/tg/parse'
import { fixture } from '../helpers/mockFetch'

function textEl(inner: string) {
  const doc = parseHtml(`<html><body><div class="tgme_widget_message_text">${inner}</div></body></html>`)
  const el = doc.querySelector('.tgme_widget_message_text')
  if (!el) throw new Error('未找到正文节点')
  return el
}

describe('TestExtractTitleContract', () => {
  const cases: Array<[string, string, string]> = [
    ['跳过日期头取真正的作品名', '<b>📅 9月9日</b><br/>名称：仙逆 4K 合集<br/>简介：xxxx', '仙逆 4K 合集'],
    ['以话题标签开头时跳到下一行', '#影视<br/>遮天 全季<br/>描述：yyy', '遮天 全季'],
    ['遇到简介关键字只保留前半段', '凡人修仙传 全集 简介：一个普通少年的修仙路', '凡人修仙传 全集'],
    ['链接文本参与取行且HTML实体被解码', '<a href="https://pan.quark.cn/s/abc">兰香如故 &amp; 番外</a><br/>资源说明：zzz', '兰香如故 & 番外'],
    ['注释内容不计入文本', '<!-- 隐藏注释 -->漫长的季节<br/>其它：q', '漫长的季节'],
    ['正文为空时回落到纯文本内容', '', ''],
  ]
  for (const [name, html, want] of cases) {
    it(name, () => {
      const el = textEl(html)
      expect(extractTitle(messageTextWithBreaks(el), textContent(el))).toBe(want)
    })
  }
})

describe('TestMessageTextWithBreaksContract', () => {
  const cases: Array<[string, string, string]> = [
    ['br自闭合与普通写法都记为换行', '第一行<br/>第二行<br>第三行', '第一行\n第二行\n第三行'],
    ['标签被剥离但保留文本', '<b>粗体</b>与<i>斜体</i>', '粗体与斜体'],
    ['实体解码', '兰香如故 &amp; 番外 &lt;合集&gt;', '兰香如故 & 番外 <合集>'],
    ['注释丢弃', '可见<!-- 隐藏 -->文本', '可见文本'],
    ['嵌套元素内的换行保留', '<span>上<br/>下</span>', '上\n下'],
  ]
  for (const [name, html, want] of cases) {
    it(name, () => expect(messageTextWithBreaks(textEl(html))).toBe(want))
  }

  // goquery Text() 不会把 <br> 变换行；node-html-parser 的 .text 会，所以自己实现
  it('textContent 不把 br 当换行（与 goquery Text() 一致）', () => {
    expect(textContent(textEl('a<br>b'))).toBe('ab')
  })
})

describe('TestParseSearchResultsStatus', () => {
  const noMessagesHTML = `<html><body><section class="tgme_channel_history js-message_history">
		<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message_centered"><div class="tme_no_messages_found">No posts found</div></div></div>
	</section></body></html>`
  const brokenHTML = `<html><body>
		<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="ch/123">
			<div class="tgme_widget_message_text">仙逆 4K 合集</div>
		</div></div>
	</body></html>`
  const okHTML = `<html><body>
		<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="ch/123">
			<div class="tgme_widget_message_date"><time datetime="2026-09-24T10:00:00+00:00">2026-09-24</time></div>
			<div class="tgme_widget_message_text">仙逆 4K 合集<br/><a href="https://pan.quark.cn/s/abc">夸克网盘</a></div>
		</div></div>
	</body></html>`
  const noLinksHTML = `<html><body>
		<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="ch/124">
			<div class="tgme_widget_message_date"><time datetime="2026-09-24T10:00:00+00:00">2026-09-24</time></div>
			<div class="tgme_widget_message_text">仙逆 讨论贴，没有网盘链接</div>
		</div></div>
	</body></html>`

  const cases: Array<[string, string, string, number]> = [
    ['正常页面解析出结果', okHTML, ParseStatus.OK, 1],
    ['页面明确无结果', noMessagesHTML, ParseStatus.NoMessages, 0],
    ['有消息块但解析失败', brokenHTML, ParseStatus.StructureChanged, 0],
    ['消息完好但无网盘链接不算结构失效', noLinksHTML, ParseStatus.OK, 0],
  ]
  for (const [name, html, status, count] of cases) {
    it(name, () => {
      const r = parseSearchResultsWithStatus(html, 'testchannel')
      expect(r.status).toBe(status)
      expect(r.results.length).toBe(count)
    })
  }

  it('正常页面的字段', () => {
    const r = parseSearchResultsWithStatus(okHTML, 'testchannel').results[0]!
    expect(r.unique_id).toBe('testchannel_123')
    expect(r.message_id).toBe('123')
    expect(r.channel).toBe('testchannel')
    expect(r.datetime).toBe('2026-09-24T10:00:00Z')
    expect(r.title).toBe('仙逆 4K 合集')
    expect(r.links[0]).toMatchObject({ type: 'quark', url: 'https://pan.quark.cn/s/abc', work_title: '仙逆 4K 合集' })
  })
})

describe('TestParseSearchResultsWithStatusPropagatesError', () => {
  it('空页面不抛错、结果为空', () => {
    expect(parseSearchResultsWithStatus('', 'testchannel').results).toEqual([])
  })
})

describe('TestParseAllNetdiskTypesFixture', () => {
  const html = `<html><body>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/1">
  <div class="tgme_widget_message_date"><time datetime="2024-01-02T03:04:05+00:00"></time></div>
  <div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text">
    百度网盘：https://pan.baidu.com/s/1AbCdEf 提取码：1234<br>天翼云盘：https://cloud.189.cn/t/xyzabc 访问码：abcd<br>
    UC网盘：https://drive.uc.cn/s/uc123 提取码：uc99<br>123网盘：https://www.123pan.com/s/pan123 提取码：p123<br>
    115网盘：https://115.com/s/abc115 访问码：p115<br>阿里云盘：https://www.aliyundrive.com/s/ali999
  </div></div>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/2">
  <div class="tgme_widget_message_date"><time datetime="2024-01-02T03:04:05+00:00"></time></div>
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_text">只有按钮里有链接</div>
    <div class="tgme_widget_message_inline_keyboard"><a href="https://www.alipan.com/s/btn888">按钮文字 提取码 bt01</a></div>
  </div>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/3">
  <div class="tgme_widget_message_date"><time datetime="2024-01-02T03:04:05+00:00"></time></div>
  <div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text">这条没有任何网盘链接，应被丢弃</div></div>
</div></div>
</body></html>`

  it('六种类型 + 按钮链接', () => {
    const { results, status } = parseSearchResultsWithStatus(html, 'chan')
    expect(status).toBe(ParseStatus.OK)
    expect(results.length).toBe(2)
    const l = results[0]!.links
    expect(l.map((x) => x.type)).toEqual(['baidu', 'tianyi', 'uc', '123', '115', 'aliyun'])
    expect(l[0]!.url).toBe('https://pan.baidu.com/s/1AbCdEf?pwd=1234')
    // 最后一个阿里云盘本行无码，回退旧逻辑取整条消息首个码
    expect(l.map((x) => x.password)).toEqual(['1234', 'abcd', 'uc99', 'p123', 'p115', '1234'])
    const btn = results[1]!.links
    expect(btn.length).toBe(1)
    expect(btn[0]).toMatchObject({ type: 'aliyun', url: 'https://www.alipan.com/s/btn888' })
  })
})

describe('TestParseSearchResultsExtractsInlineKeyboardLinks', () => {
  const html = `<!DOCTYPE html>
<html><body>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="testchannel/100">
    <div class="tgme_widget_message_text">藏锋（2026）<br>网盘资源 <a href="https://pan.baidu.com/s/1dfyBU2ABaVepdzHhyXweRg?pwd=xeqy">正文百度链接</a></div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="https://t.me/testchannel/100">
        <time datetime="2026-09-10T00:00:00+00:00">00:00</time>
      </a>
    </div>
  </div>
  <div class="tgme_widget_message_inline_keyboard">
    <div class="tgme_widget_message_inline_row">
      <a class="tgme_widget_message_inline_button url_button" href="https://pan.baidu.com/s/1dfyBU2ABaVepdzHhyXweRg?pwd=xeqy"><span>百度</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://pan.baidu.com/s/passwordless123"><span>百度无密码</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://pan.quark.cn/s/92f07db5654b"><span>夸克 提取码：qwer</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://pan.xunlei.com/s/VP-EzzPFb8z7tideTMh-U-WTA1?pwd=vuiy#"><span>迅雷</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://cloud.189.cn/t/abc123"><span>天翼</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://drive.uc.cn/s/abc123"><span>UC</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://123pan.com/s/abc123"><span>123</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://115.com/s/abc123"><span>115</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://www.alipan.com/s/abc123"><span>阿里</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://guangyapan.com/s/abc123"><span>光鸭</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://caiyun.139.com/w/i/abc123"><span>移动</span></a>
      <a class="tgme_widget_message_inline_button callback_button" data-callback="ignored"><span>回调</span></a>
      <a class="tgme_widget_message_inline_button url_button" href="https://example.com/not-a-pan"><span>官网</span></a>
    </div>
  </div>
</div>
</body></html>`

  it('按钮链接全部提取、类型与密码正确、无重复', () => {
    const results = parseSearchResults(html, 'testchannel')
    expect(results.length).toBe(1)
    const links = results[0]!.links
    expect(links.length).toBe(11)
    const byUrl = new Map<string, [string, string]>()
    for (const l of links) {
      expect(byUrl.has(l.url)).toBe(false)
      byUrl.set(l.url, [l.type, l.password])
    }
    const checks: Record<string, [string, string]> = {
      'https://pan.baidu.com/s/1dfyBU2ABaVepdzHhyXweRg?pwd=xeqy': ['baidu', 'xeqy'],
      'https://pan.baidu.com/s/passwordless123': ['baidu', ''],
      'https://pan.quark.cn/s/92f07db5654b': ['quark', 'qwer'],
      'https://pan.xunlei.com/s/VP-EzzPFb8z7tideTMh-U-WTA1?pwd=vuiy#': ['xunlei', 'vuiy'],
      'https://cloud.189.cn/t/abc123': ['tianyi', ''],
      'https://drive.uc.cn/s/abc123': ['uc', ''],
      'https://123pan.com/s/abc123': ['123', ''],
      'https://115.com/s/abc123': ['115', ''],
      'https://www.alipan.com/s/abc123': ['aliyun', ''],
      'https://guangyapan.com/s/abc123': ['guangya', ''],
      'https://caiyun.139.com/w/i/abc123': ['mobile', ''],
    }
    for (const [u, want] of Object.entries(checks)) expect(byUrl.get(u), u).toEqual(want)
  })
})

describe('TestParseSearchResultsSkipsTelegramDateHeaderForTitle', () => {
  const html = `<!DOCTYPE html>
<html><body>
<div class="tgme_widget_message_wrap">
  <div class="tgme_widget_message" data-post="peccxinpd/408032">
    <div class="tgme_widget_message_text"><b>📅 9月9日</b><br><br>🎬 ✅【<mark>藏锋</mark>（2026）】【全23集】【4K高码】<br><br>类型：国产剧<br>网盘：百度网盘<br>📝 简介：测试简介</div>
    <div class="tgme_widget_message_footer">
      <a class="tgme_widget_message_date" href="https://t.me/peccxinpd/408032">
        <time datetime="2026-09-09T12:02:55+00:00">12:02</time>
      </a>
    </div>
  </div>
  <div class="tgme_widget_message_inline_keyboard">
    <a class="tgme_widget_message_inline_button url_button" href="https://pan.baidu.com/s/1dfyBU2ABaVepdzHhyXweRg?pwd=xeqy"><span>查看资源</span></a>
  </div>
</div>
</body></html>`

  it('标题跳过日期头', () => {
    const results = parseSearchResults(html, 'peccxinpd')
    expect(results.length).toBe(1)
    expect(results[0]!.title).toContain('藏锋')
    expect(results[0]!.links[0]!.work_title).toContain('藏锋')
  })
})

describe('真实页面夹具', () => {
  const aliyun = fixture('tg/tg_channel_shareAliyun_real.html')

  it('TestParseRealChannelPageFixture', () => {
    const { results, status } = parseSearchResultsWithStatus(aliyun, 'shareAliyun')
    expect(status).toBe(ParseStatus.OK)
    expect(results.length).toBe(20)
    const domains = { aliyundrive: 0, alipan: 0 }
    for (const r of results) {
      expect(r.unique_id.startsWith('shareAliyun_')).toBe(true)
      expect(r.datetime.startsWith('0001-')).toBe(false)
      expect(r.links.length).toBeGreaterThan(0)
      for (const l of r.links) {
        expect(l.type).toBe('aliyun')
        if (l.url.startsWith('https://www.aliyundrive.com/s/')) domains.aliyundrive++
        else if (l.url.startsWith('https://www.alipan.com/s/')) domains.alipan++
        else throw new Error(`链接形态异常: ${l.url}`)
      }
    }
    expect(domains).toEqual({ aliyundrive: 16, alipan: 4 })
    const first = results[0]!
    expect(first.unique_id).toBe('shareAliyun_45740')
    expect(first.title).toBe('骄阳伴我(2023) S01E01-E05 4K')
    expect(first.links.length).toBe(1)
    expect(first.links[0]!.url).toBe('https://www.aliyundrive.com/s/7H1P3TqeXey')
  })

  it('TestParseRealChannelPageFixtureUsesChannelInID', () => {
    for (const ch of ['shareAliyun', '另一个频道']) {
      const { results, status } = parseSearchResultsWithStatus(aliyun, ch)
      expect(status).toBe(ParseStatus.OK)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.unique_id.startsWith(`${ch}_`)).toBe(true)
    }
  })

  it('TestParseRealCodesPageFixture', () => {
    const { results, status } = parseSearchResultsWithStatus(fixture('tg/tg_channel_leoziyuan_with_codes.html'), 'leoziyuan')
    expect(status).toBe(ParseStatus.OK)
    expect(results.length).toBe(20)
    let links = 0
    let coded = 0
    for (const r of results) {
      expect(r.links.length).toBeGreaterThan(0)
      for (const l of r.links) {
        links++
        if (l.password !== '') coded++
        expect(l.type).not.toBe('')
      }
    }
    expect(links).toBe(502)
    expect(coded).toBe(19)
  })
})

describe('补充：标签 / 图片 / 作品标题', () => {
  const page = (inner: string, extra = '') => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="c/9">
    <div class="tgme_widget_message_bubble">${extra}<div class="tgme_widget_message_text">${inner}</div></div>
    <div class="tgme_widget_message_date"><time datetime="2026-01-01T08:00:00+08:00"></time></div></div></div>`

  it('标签与图片（排除头像、去重）', () => {
    const html = page(
      '电影<br>https://pan.quark.cn/s/abcd1234 <a href="?q=%23电影">#电影</a> <a href="?q=%23x">非标签</a>',
      `<a class="tgme_widget_message_photo_wrap" style="width:100px;background-image:url('https://cdn/a.jpg')"></a>
       <a class="tgme_widget_message_photo_wrap" style='background-image:url("https://cdn/a.jpg")'></a>
       <img src="https://cdn/b.jpg">`,
    ).replace('<div class="tgme_widget_message_bubble">', '<i class="tgme_widget_message_user"><img src="https://cdn/avatar.jpg"></i><div class="tgme_widget_message_bubble">')
    const r = parseSearchResults(html, 'c')[0]!
    expect(r.tags).toEqual(['电影'])
    expect(r.images).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg'])
    expect(r.datetime).toBe('2026-01-01T00:00:00Z')
  })

  it('链接>4 且为单行格式时逐条取作品标题', () => {
    const lines = ['A丨夸克：https://pan.quark.cn/s/aaaa1111', 'B丨夸克：https://pan.quark.cn/s/bbbb2222', 'C丨夸克：https://pan.quark.cn/s/cccc3333', 'D丨夸克：https://pan.quark.cn/s/dddd4444', 'E丨夸克：https://pan.quark.cn/s/eeee5555']
    const r = parseSearchResults(page(lines.join('<br>\n')), 'c')[0]!
    expect(r.links.length).toBe(5)
    expect(r.links.map((l) => l.work_title).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('链接>4 非单行格式时用默认标题', () => {
    const lines = ['标题行', ...[1, 2, 3, 4, 5].map((i) => `https://pan.quark.cn/s/abcd000${i}`)]
    const r = parseSearchResults(page(lines.join('<br>\n')), 'c')[0]!
    expect(r.links.length).toBe(5)
    for (const l of r.links) expect(l.work_title).toBe('标题行')
  })
})
