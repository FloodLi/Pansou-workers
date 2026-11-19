import { searchMacCms } from './_helpers/maccms'
import { definePlugin } from './types'

export default definePlugin({
  name: 'ouge',
  priority: 2,
  skipServiceFilter: false,
  // 与 wanou 同一上游域名，但是独立插件（类型判定规则不同）
  search: (keyword, ctx) => searchMacCms(ctx.http, 'ouge', keyword),
})
