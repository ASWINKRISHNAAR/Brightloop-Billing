export type BillingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Days in month helper, taking leap years into account.
 */
export function getDaysInMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate();
}

/**
 * Format a Date object to YYYY-MM-DD calendar date string.
 */
export function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a YYYY-MM-DD string into a UTC Date object.
 */
export function parseDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  const y = parseInt(parts[0] || '1970', 10);
  const m = parseInt(parts[1] || '1', 10) - 1;
  const d = parseInt(parts[2] || '1', 10);
  return new Date(Date.UTC(y, m, d));
}

/**
 * Anchor-based, month-end clamped date addition with zero drift.
 * @param startDateStr Calendar start date in YYYY-MM-DD format (the immutable anchor)
 * @param period Billing period (daily, weekly, monthly, yearly)
 * @param count Number of periods to advance
 */
export function addPeriods(startDateStr: string, period: BillingPeriod, count: number): string {
  if (count === 0) {
    return startDateStr;
  }

  const anchor = parseDate(startDateStr);
  const anchorYear = anchor.getUTCFullYear();
  const anchorMonth = anchor.getUTCMonth();
  const anchorDay = anchor.getUTCDate();

  if (period === 'daily') {
    const d = new Date(Date.UTC(anchorYear, anchorMonth, anchorDay + count));
    return formatDate(d);
  }

  if (period === 'weekly') {
    const d = new Date(Date.UTC(anchorYear, anchorMonth, anchorDay + count * 7));
    return formatDate(d);
  }

  if (period === 'monthly') {
    const targetMonthTotal = anchorMonth + count;
    const targetYear = anchorYear + Math.floor(targetMonthTotal / 12);
    const targetMonth = ((targetMonthTotal % 12) + 12) % 12;

    const maxDays = getDaysInMonth(targetYear, targetMonth);
    // Month-end clamp: if anchor was 31 and target month has 30 days, clamp to 30.
    const clampedDay = Math.min(anchorDay, maxDays);

    return formatDate(new Date(Date.UTC(targetYear, targetMonth, clampedDay)));
  }

  if (period === 'yearly') {
    const targetYear = anchorYear + count;
    const maxDays = getDaysInMonth(targetYear, anchorMonth);
    // Leap year clamp: Feb 29 in non-leap year clamps to Feb 28
    const clampedDay = Math.min(anchorDay, maxDays);

    return formatDate(new Date(Date.UTC(targetYear, anchorMonth, clampedDay)));
  }

  throw new Error(`Unsupported billing period: ${period}`);
}

/**
 * Subtract 1 calendar day from a YYYY-MM-DD date.
 */
export function subtractOneDay(dateStr: string): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatDate(d);
}

/**
 * Add calendar days to a YYYY-MM-DD date.
 */
export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/**
 * Calculate the exact period start and period end for a billing cycle.
 * periodStart = addPeriods(startDate, period, cycleIndex)
 * periodEnd   = subtractOneDay(addPeriods(startDate, period, cycleIndex + 1))
 */
export function calculateBillingCycle(
  startDateStr: string,
  period: BillingPeriod,
  cycleIndex: number
): { periodStart: string; periodEnd: string } {
  const periodStart = addPeriods(startDateStr, period, cycleIndex);
  const nextStart = addPeriods(startDateStr, period, cycleIndex + 1);
  const periodEnd = subtractOneDay(nextStart);

  return { periodStart, periodEnd };
}
