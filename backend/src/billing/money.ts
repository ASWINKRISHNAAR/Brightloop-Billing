/**
 * Money utilities using pure integer cents.
 * Hard constraint: Never use floating point arithmetic for money.
 */

export class Money {
  /**
   * Convert decimal dollar string or number to integer cents.
   * e.g. "49.99" -> 4999, 50 -> 5000, "0.1" -> 10
   */
  public static toCents(amount: string | number): number {
    if (typeof amount === 'number') {
      return Math.round(amount * 100);
    }
    const clean = amount.trim();
    if (!clean) return 0;
    const parts = clean.split('.');
    const dollars = parseInt(parts[0] || '0', 10);
    const centsStr = (parts[1] || '').padEnd(2, '0').slice(0, 2);
    const cents = parseInt(centsStr, 10);
    const sign = dollars < 0 || clean.startsWith('-') ? -1 : 1;
    return sign * (Math.abs(dollars) * 100 + cents);
  }

  /**
   * Format integer cents to decimal string with 2 decimal places.
   * e.g. 4999 -> "49.99", 5000 -> "50.00", 5 -> "0.05"
   */
  public static toDecimal(cents: number): string {
    const isNegative = cents < 0;
    const abs = Math.abs(cents);
    const dollars = Math.floor(abs / 100);
    const remainder = abs % 100;
    return `${isNegative ? '-' : ''}${dollars}.${remainder.toString().padStart(2, '0')}`;
  }

  /**
   * Calculate percentage of cents deterministically rounded half-up.
   * e.g. 10% of 155 cents: (155 * 1000 + 5000) / 10000 = 16 cents
   */
  public static calculatePercentage(baseCents: number, ratePercentage: number): number {
    if (baseCents <= 0 || ratePercentage <= 0) return 0;
    // ratePercentage e.g. 15.5 for 15.5%
    // baseCents * ratePercentage / 100
    // Math.round((baseCents * ratePercentage) / 100)
    return Math.round((baseCents * ratePercentage) / 100);
  }

  /**
   * Distribute fixed discount cents across multiple line gross cents proportionally,
   * deterministically allocating remainder cents to the largest lines so sum(allocated) === totalDiscount.
   */
  public static distributeProportionally(totalDiscountCents: number, lineAmountsCents: number[]): number[] {
    const totalGross = lineAmountsCents.reduce((sum, amt) => sum + amt, 0);
    if (totalGross <= 0 || totalDiscountCents <= 0) {
      return lineAmountsCents.map(() => 0);
    }

    // Clamp total discount at totalGross
    const clampedDiscount = Math.min(totalDiscountCents, totalGross);

    let allocatedTotal = 0;
    const result: number[] = [];
    const remainders: Array<{ index: number; frac: number }> = [];

    for (let i = 0; i < lineAmountsCents.length; i++) {
      const lineGross = lineAmountsCents[i]!;
      const exact = (clampedDiscount * lineGross) / totalGross;
      const base = Math.floor(exact);
      result.push(base);
      allocatedTotal += base;
      remainders.push({ index: i, frac: exact - base });
    }

    // Distribute remaining cents deterministically by largest fraction, then index
    remainders.sort((a, b) => b.frac - a.frac || a.index - b.index);

    let left = clampedDiscount - allocatedTotal;
    let rIdx = 0;
    while (left > 0 && rIdx < remainders.length) {
      const target = remainders[rIdx]!.index;
      result[target]! += 1;
      left -= 1;
      rIdx++;
    }

    return result;
  }
}
