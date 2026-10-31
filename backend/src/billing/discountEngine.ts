import { query, DbClient } from '../db/pool.js';
import { Money } from './money.js';

export interface DiscountRow {
  id: string;
  name: string;
  code: string | null;
  type: 'fixed' | 'percentage';
  value: string;
  scope: 'product' | 'subscription';
  min_purchase: string | null;
  min_quantity: number | null;
  start_date: string;
  end_date: string;
  usage_limit: number | null;
  used_count: number;
  is_active: boolean;
}

export interface LineForDiscount {
  productId: string;
  quantity: number;
  grossCents: number;
}

export interface AppliedDiscountResult {
  discountId: string;
  discountName: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  totalDiscountCents: number;
  lineDiscountsCents: number[];
}

export class DiscountEngine {
  /**
   * Find all active eligible discounts for the subscription / products
   */
  async findEligibleDiscounts(
    asOfDate: string,
    subtotalCents: number,
    totalQuantity: number,
    subscriptionId: string,
    productIds: string[],
    client?: DbClient
  ): Promise<DiscountRow[]> {
    const res = await query<DiscountRow>(
      `SELECT d.*
       FROM discounts d
       LEFT JOIN discount_subscriptions ds ON ds.discount_id = d.id
       LEFT JOIN discount_products dp ON dp.discount_id = d.id
       WHERE d.is_active = true
         AND $1::date >= d.start_date AND $1::date <= d.end_date
         AND (d.usage_limit IS NULL OR d.used_count < d.usage_limit)
         AND (d.min_purchase IS NULL OR $2 >= (d.min_purchase * 100))
         AND (d.min_quantity IS NULL OR $3 >= d.min_quantity)
         AND (
           (d.scope = 'subscription' AND (ds.subscription_id IS NULL OR ds.subscription_id = $4))
           OR
           (d.scope = 'product' AND dp.product_id = ANY($5))
         )
       ORDER BY d.created_at ASC`,
      [asOfDate, subtotalCents, totalQuantity, subscriptionId, productIds],
      client
    );

    return res.rows;
  }

  /**
   * Select the single best discount that maximizes customer savings,
   * without stacking.
   */
  evaluateBestDiscount(
    discounts: DiscountRow[],
    lines: LineForDiscount[]
  ): AppliedDiscountResult | null {
    if (discounts.length === 0 || lines.length === 0) {
      return null;
    }

    const totalGrossCents = lines.reduce((sum, l) => sum + l.grossCents, 0);
    if (totalGrossCents <= 0) {
      return null;
    }

    let bestResult: AppliedDiscountResult | null = null;
    let maxSavingsCents = 0;

    for (const d of discounts) {
      const val = parseFloat(d.value);
      let savingsCents = 0;
      let lineDiscounts: number[] = [];

      if (d.type === 'percentage') {
        // Percentage discount
        lineDiscounts = lines.map((l) => Money.calculatePercentage(l.grossCents, val));
        savingsCents = lineDiscounts.reduce((sum, amt) => sum + amt, 0);
      } else {
        // Fixed amount discount
        const fixedCents = Money.toCents(val);
        const lineAmounts = lines.map((l) => l.grossCents);
        lineDiscounts = Money.distributeProportionally(fixedCents, lineAmounts);
        savingsCents = lineDiscounts.reduce((sum, amt) => sum + amt, 0);
      }

      // Clamp savings to not exceed gross
      savingsCents = Math.min(savingsCents, totalGrossCents);

      if (savingsCents > maxSavingsCents) {
        maxSavingsCents = savingsCents;
        bestResult = {
          discountId: d.id,
          discountName: d.name,
          discountType: d.type,
          discountValue: val,
          totalDiscountCents: savingsCents,
          lineDiscountsCents: lineDiscounts
        };
      }
    }

    return bestResult;
  }

  /**
   * Atomically claims discount usage during billing generation.
   * Concurrency-safe: rowCount === 0 if limit was reached by another transaction.
   */
  async claimDiscountAtomic(discountId: string, asOfDate: string, client: DbClient): Promise<boolean> {
    const res = await query(
      `UPDATE discounts
       SET used_count = used_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND (usage_limit IS NULL OR used_count < usage_limit)
         AND $2::date >= start_date AND $2::date <= end_date
         AND is_active = true
       RETURNING id, used_count`,
      [discountId, asOfDate],
      client
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Release discount usage if an invoice is cancelled.
   */
  async releaseDiscount(discountId: string, client?: DbClient): Promise<void> {
    await query(
      `UPDATE discounts
       SET used_count = GREATEST(0, used_count - 1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [discountId],
      client
    );
  }
}

export const discountEngine = new DiscountEngine();
