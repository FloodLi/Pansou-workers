// 合成数据，依据 Go 解析逻辑构造，非真实抓取
import { describe, expect, it } from 'vitest'
import { parseMacCmsLinks } from '../../src/plugins/_helpers/maccms'

describe('maccms helper', () => {
  it('按下标配对并截断到较短数组', () => {
    const links = parseMacCmsLinks('wanou', 'KG$$$BD$$$UC', 'https://pan.quark.cn/s/a1$$$https://pan.baidu.com/s/b2?pwd=x1y2')
    expect(links.map((l) => [l.type, l.password])).toEqual([
      ['quark', ''],
      ['baidu', 'x1y2'],
    ])
  })
  it('空输入返回空数组', () => {
    expect(parseMacCmsLinks('wanou', '', 'x')).toEqual([])
    expect(parseMacCmsLinks('ouge', 'KG', '')).toEqual([])
  })
  it('wanou 校验接口标识与 URL 一致，否则回退 URL 识别', () => {
    const [l] = parseMacCmsLinks('wanou', 'BD', 'https://pan.quark.cn/s/a1')
    expect(l?.type).toBe('quark')
  })
  it('ouge 优先信任接口标识，PK 映射 pikpak，wanou 不识别 PK 则回退 URL', () => {
    expect(parseMacCmsLinks('ouge', 'BD', 'https://pan.quark.cn/s/a1')[0]?.type).toBe('baidu')
    expect(parseMacCmsLinks('ouge', 'PK', 'https://mypikpak.com/s/p1')[0]?.type).toBe('pikpak')
    expect(parseMacCmsLinks('wanou', 'PIKPAK', 'https://mypikpak.com/s/p1')[0]?.type).toBe('pikpak')
  })
  it('过滤 javascript、锚点与未知域名', () => {
    expect(parseMacCmsLinks('ouge', 'KG', 'javascript:void(0)')).toEqual([])
    expect(parseMacCmsLinks('wanou', 'KG', 'https://pan.quark.cn/s/a1#x')).toEqual([])
    expect(parseMacCmsLinks('ouge', 'XX', 'https://example.com/a')).toEqual([])
  })
})
