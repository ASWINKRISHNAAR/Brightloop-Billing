import { query, DbClient } from '../db/pool.js';
import { Money } from './money.js';

export interface ProductTaxRate {
  productId: string;
  combinedTaxRate: number; // e.g. 10.0 for 10%
  breakdown: Array<{ taxId: string; name: string; rate: number }>;
}

export class TaxEngine {
  /**
   * Fetch active tax rates for an array of product IDs
   */
  async getTaxRatesForProducts(productIds: string[], client?: DbClient): Promise<Map<string, ProductTaxRate>> {
    const rateMap = new Map<string, ProductTaxRate>();
    if (productIds.length === 0) return rateMap;

    const res = await query<{
      product_id: string;
      tax_id: string;
      name: string;
      rate: string;
    }>(
      `SELECT pt.product_id, t.id as tax_id, t.name, t.rate
       FROM product_taxes pt
       JOIN taxes t ON t.id = pt.tax_id
       WHERE pt.product_id = ANY($1) AND t.is_active = true`,
      [productIds],
      client
    );

    for (const row of res.rows) {
      const pid = row.product_id;
      const rateNum = parseFloat(row.rate);
      if (!rateMap.has(pid)) {
        rateMap.set(pid, {
          productId: pid,
          combinedTaxRate: 0,
          breakdown: []
        });
      }

      const entry = rateMap.get(pid)!;
      entry.combinedTaxRate += rateNum;
      entry.breakdown.push({
        taxId: row.tax_id,
        name: row.name,
        rate: rateNum
      });
    }

    return rateMap;
  }

  /**
   * Calculate line tax in integer cents based on net cents (gross - discount)
   */
  calculateLineTax(netCents: number, combinedRatePercentage: number): number {
    return Money.calculatePercentage(netCents, combinedRatePercentage);
  }
}

export const taxEngine = new TaxEngine();
