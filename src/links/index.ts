// 链接模块对外接口（完整移植自 util/regex_util.go 与 util/parser_util.go 的纯字符串部分）。
export { CLOUD_TYPES, getLinkType } from './classify'
export {
  cleanLinkUrl,
  cleanBaiduPanURL,
  cleanTianyiPanURL,
  cleanUCPanURL,
  clean123PanURL,
  clean115PanURL,
  cleanAliyunPanURL,
  cleanMobilePanURL,
  queryUnescape,
} from './clean'
export { extractPassword, isValidPassword } from './password'
export { extractNetDiskLinks, normalizeURLForComparison } from './extract'
export {
  normalizeUrl,
  isSupportedLink,
  passwordFor,
  extractCodeNear,
  anchorCandidates,
  normalizeBaiduPanURL,
  normalizeTianyiPanURL,
  normalizeUCPanURL,
  normalize123PanURL,
  normalize115PanURL,
  normalizeAliyunPanURL,
} from './parser'
export * from './patterns'
