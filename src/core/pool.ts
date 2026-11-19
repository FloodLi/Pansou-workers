/** Workers 同一次调用同时打开的出站连接最多 6 个。 */
export const MAX_CONNECTIONS = 6

/** 带并发上限的 map：保持输入顺序；任一元素抛错时该元素结果为 rejected，由调用方自行处理。 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i] as T, i) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  return results
}

/** 取出 fulfilled 的值，丢弃失败项。 */
export function fulfilled<R>(settled: PromiseSettledResult<R>[]): R[] {
  const out: R[] = []
  for (const s of settled) if (s.status === 'fulfilled') out.push(s.value)
  return out
}
