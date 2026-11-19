/** 子请求预算耗尽。上层应只让当前来源失败，不影响其他来源。 */
export class BudgetExceeded extends Error {
  constructor(limit: number) {
    super(`子请求预算已用尽（上限 ${limit}）`)
    this.name = 'BudgetExceeded'
  }
}

/**
 * 请求级子请求预算。所有出站 fetch 与缓存读写都必须先 take()。
 * 免费版每次调用最多 50 个子请求，超限后 fetch 会直接抛错。
 */
export class SubrequestBudget {
  private used = 0

  constructor(readonly limit: number) {}

  take(n = 1): void {
    if (this.used + n > this.limit) throw new BudgetExceeded(this.limit)
    this.used += n
  }

  get usedCount(): number {
    return this.used
  }

  get remaining(): number {
    return this.limit - this.used
  }
}
