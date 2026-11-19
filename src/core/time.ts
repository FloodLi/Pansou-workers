import { ZERO_TIME } from '../types'

/** 无时区的时间一律按 UTC 解析，与原项目（Go 的 time.Parse / 容器默认 UTC）一致。 */
const NO_TZ = 'Z'

export function isZeroTime(s: string | undefined): boolean {
  return !s || s === ZERO_TIME || s.startsWith('0001-01-01')
}

/**
 * 解析常见时间格式为 RFC3339（UTC，秒精度）。无法解析时返回 ZERO_TIME。
 * 无时区的 "YYYY-MM-DD HH:mm:ss" 按 UTC 处理（与原项目一致）。
 */
export function parseTime(input: string | number | undefined | null): string {
  if (input === undefined || input === null || input === '') return ZERO_TIME
  if (typeof input === 'number') return fromEpoch(input)
  const s = input.trim()
  if (!s) return ZERO_TIME
  if (/^\d{10}$/.test(s)) return fromEpoch(Number(s))
  if (/^\d{13}$/.test(s)) return fromEpoch(Number(s) / 1000)

  // 2024-05-01 / 2024/05/01 / 2024.05.01 [HH:mm[:ss]]
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const [, y = '', mo = '', d = '', h = '0', mi = '0', se = '0'] = m
    return iso(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se)}${NO_TZ}`)
  }
  // 2024年05月01日 [HH:mm[:ss]]
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const [, y = '', mo = '', d = '', h = '0', mi = '0', se = '0'] = m
    return iso(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se)}${NO_TZ}`)
  }
  // RFC3339 及 Date 能识别的其他格式
  return iso(s)
}

function pad(n: string): string {
  return n.padStart(2, '0')
}

function fromEpoch(sec: number): string {
  const d = new Date(sec * 1000)
  return Number.isNaN(d.getTime()) ? ZERO_TIME : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function iso(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1971) return ZERO_TIME
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}
