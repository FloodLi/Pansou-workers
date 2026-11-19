/** 14 类链接类型，对应原项目 util.GetLinkType。 */
export const CLOUD_TYPES = [
  'baidu',
  'aliyun',
  'quark',
  'guangya',
  'tianyi',
  'uc',
  'mobile',
  '115',
  'pikpak',
  'xunlei',
  '123',
  'magnet',
  'ed2k',
  'others',
] as const

const PAN123_HOSTS = ['123684.com', '123685.com', '123865.com', '123912.com', '123pan.com', '123pan.cn', '123592.com']

export function getLinkType(rawUrl: string): string {
  let url = rawUrl.toLowerCase()

  // 处理可能带有"链接："前缀的情况
  if (url.includes('链接：') || url.includes('链接:')) {
    url = (url.split('链接')[1] ?? '').replace(/^[：:]/, '').trim()
  }

  if (url.includes('ed2k:')) return 'ed2k'
  if (url.startsWith('magnet:')) return 'magnet'
  if (url.includes('pan.baidu.com')) return 'baidu'
  if (url.includes('pan.quark.cn')) return 'quark'
  if (url.includes('alipan.com') || url.includes('aliyundrive.com')) return 'aliyun'
  if (url.includes('guangyapan.com')) return 'guangya'
  if (url.includes('cloud.189.cn')) return 'tianyi'
  if (url.includes('drive.uc.cn')) return 'uc'
  if (url.includes('caiyun.139.com') || url.includes('yun.139.com') || url.includes('caiyun.feixin.10086.cn')) {
    return 'mobile'
  }
  if (url.includes('115.com') || url.includes('115cdn.com') || url.includes('anxia.com')) return '115'
  if (url.includes('mypikpak.com')) return 'pikpak'
  if (url.includes('pan.xunlei.com')) return 'xunlei'
  if (PAN123_HOSTS.some((h) => url.includes(h))) return '123'
  return 'others'
}
