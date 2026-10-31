import crypto from 'crypto';
import { query, DbClient, withTransaction } from '../../db/pool.js';
import { DiscountRow } from '../../billing/discountEngine.js';

export interface DiscountWithRelations extends DiscountRow {
  product_ids?: string[];
  subscription_ids?: string[];
}

export class DiscountsRepository {
  async listDiscounts(client?: DbClient): Promise<DiscountWithRelations[]> {
    const res = await query<DiscountRow>(
      'SELECT * FROM discounts ORDER BY created_at DESC',
      [],
      client
    );
    return res.rows;
  }

  async findDiscountById(id: string, client?: DbClient): Promise<DiscountWithRelations | null> {
    const res = await query<DiscountRow>('SELECT * FROM discounts WHERE id = $1', [id], client);
    const discount: DiscountWithRelations | null = res.rows[0] || null;
    if (!discount) return null;

    const prodRes = await query<{ product_id: string }>(
      'SELECT product_id FROM discount_products WHERE discount_id = $1',
      [id],
      client
    );
    discount.product_ids = prodRes.rows.map((r) => r.product_id);

    const subRes = await query<{ subscription_id: string }>(
      'SELECT subscription_id FROM discount_subscriptions WHERE discount_id = $1',
      [id],
      client
    );
    discount.subscription_ids = subRes.rows.map((r) => r.subscription_id);

    return discount;
  }

  async createDiscount(data: {
    name: string;
    code?: string;
    type: 'fixed' | 'percentage';
    value: number;
    scope: 'product' | 'subscription';
    minPurchase?: number;
    minQuantity?: number;
    startDate: string;
    endDate: string;
    usageLimit?: number;
    productIds?: string[];
    subscriptionIds?: string[];
    isActive?: boolean;
  }): Promise<DiscountWithRelations> {
    return withTransaction(async (client) => {
      const id = crypto.randomUUID();
      const res = await query<DiscountRow>(
        `INSERT INTO discounts (
          id, name, code, type, value, scope,
          min_purchase, min_quantity, start_date, end_date,
          usage_limit, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          id,
          data.name,
          data.code ?? null,
          data.type,
          data.value,
          data.scope,
          data.minPurchase ?? 0,
          data.minQuantity ?? 0,
          data.startDate,
          data.endDate,
          data.usageLimit ?? null,
          data.isActive ?? true
        ],
        client
      );
      const discount = res.rows[0]!;

      if (data.productIds && data.productIds.length > 0) {
        for (const pid of data.productIds) {
          await query(
            'INSERT INTO discount_products (discount_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, pid],
            client
          );
        }
      }

      if (data.subscriptionIds && data.subscriptionIds.length > 0) {
        for (const sid of data.subscriptionIds) {
          await query(
            'INSERT INTO discount_subscriptions (discount_id, subscription_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, sid],
            client
          );
        }
      }

      return discount;
    });
  }

  async updateDiscount(
    id: string,
    data: {
      name?: string;
      code?: string;
      type?: 'fixed' | 'percentage';
      value?: number;
      scope?: 'product' | 'subscription';
      minPurchase?: number;
      minQuantity?: number;
      startDate?: string;
      endDate?: string;
      usageLimit?: number | null;
      productIds?: string[];
      subscriptionIds?: string[];
      isActive?: boolean;
    }
  ): Promise<DiscountWithRelations | null> {
    return withTransaction(async (client) => {
      const current = await this.findDiscountById(id, client);
      if (!current) return null;

      const res = await query<DiscountRow>(
        `UPDATE discounts
         SET name = COALESCE($1, name),
             code = COALESCE($2, code),
             type = COALESCE($3, type),
             value = COALESCE($4, value),
             scope = COALESCE($5, scope),
             min_purchase = COALESCE($6, min_purchase),
             min_quantity = COALESCE($7, min_quantity),
             start_date = COALESCE($8, start_date),
             end_date = COALESCE($9, end_date),
             usage_limit = CASE WHEN $10::boolean THEN $11 ELSE usage_limit END,
             is_active = COALESCE($12, is_active),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $13
         RETURNING *`,
        [
          data.name ?? null,
          data.code ?? null,
          data.type ?? null,
          data.value !== undefined ? data.value : null,
          data.scope ?? null,
          data.minPurchase !== undefined ? data.minPurchase : null,
          data.minQuantity !== undefined ? data.minQuantity : null,
          data.startDate ?? null,
          data.endDate ?? null,
          data.usageLimit !== undefined,
          data.usageLimit ?? null,
          data.isActive !== undefined ? data.isActive : null,
          id
        ],
        client
      );

      if (data.productIds) {
        await query('DELETE FROM discount_products WHERE discount_id = $1', [id], client);
        for (const pid of data.productIds) {
          await query(
            'INSERT INTO discount_products (discount_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, pid],
            client
          );
        }
      }

      if (data.subscriptionIds) {
        await query('DELETE FROM discount_subscriptions WHERE discount_id = $1', [id], client);
        for (const sid of data.subscriptionIds) {
          await query(
            'INSERT INTO discount_subscriptions (discount_id, subscription_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, sid],
            client
          );
        }
      }

      return res.rows[0] || null;
    });
  }

  async deleteDiscount(id: string, client?: DbClient): Promise<boolean> {
    const res = await query('DELETE FROM discounts WHERE id = $1', [id], client);
    return (res.rowCount ?? 0) > 0;
  }
}

export const discountsRepository = new DiscountsRepository();
