import crypto from 'crypto';
import { query, DbClient } from '../../db/pool.js';
import { SubStatus } from './subscription.stateMachine.js';
import { ConflictError } from '../../common/errors.js';

export interface SubscriptionLineRow {
  id: string;
  subscription_id: string;
  product_id: string;
  variant_id: string | null;
  unit_price: string;
  quantity: number;
  product_name?: string;
  variant_attribute?: string;
  variant_value?: string;
}

export interface SubscriptionRow {
  id: string;
  subscription_number: string;
  customer_id: string;
  plan_id: string;
  status: SubStatus;
  start_date: string;
  expiry_date: string | null;
  next_billing_date: string | null;
  paused_until: string | null;
  notes: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  customer_name?: string;
  customer_email?: string;
  plan_name?: string;
  plan_period?: string;
  plan_price?: string;
  plan_closable?: boolean;
  plan_pausable?: boolean;
  plan_renewable?: boolean;
  plan_auto_close?: boolean;
  lines?: SubscriptionLineRow[];
}

export class SubscriptionRepository {
  private formatSubNumber(seq: number): string {
    return `SUB-${String(seq).padStart(4, '0')}`;
  }

  async getNextSubscriptionNumber(client?: DbClient): Promise<string> {
    try {
      const res = await query<{ nextval: string }>("SELECT nextval('subscription_number_seq')::text", [], client);
      const val = parseInt(res.rows[0]?.nextval || '1', 10);
      return this.formatSubNumber(val);
    } catch (_err) {
      // Fallback for in-memory or when sequence is mock
      const countRes = await query<{ count: string }>('SELECT COUNT(*) as count FROM subscriptions', [], client);
      const val = parseInt(countRes.rows[0]?.count || '0', 10) + 1;
      return this.formatSubNumber(val);
    }
  }

  async listSubscriptions(
    filters: {
      status?: SubStatus;
      customerId?: string;
      planId?: string;
      search?: string;
      startDateFrom?: string;
      startDateTo?: string;
      limit?: number;
      offset?: number;
    } = {},
    client?: DbClient
  ): Promise<{ subscriptions: SubscriptionRow[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.status) {
      conditions.push(`s.status = $${idx}`);
      params.push(filters.status);
      idx++;
    }

    if (filters.customerId) {
      conditions.push(`s.customer_id = $${idx}`);
      params.push(filters.customerId);
      idx++;
    }

    if (filters.planId) {
      conditions.push(`s.plan_id = $${idx}`);
      params.push(filters.planId);
      idx++;
    }

    if (filters.startDateFrom) {
      conditions.push(`s.start_date >= $${idx}`);
      params.push(filters.startDateFrom);
      idx++;
    }

    if (filters.startDateTo) {
      conditions.push(`s.start_date <= $${idx}`);
      params.push(filters.startDateTo);
      idx++;
    }

    if (filters.search) {
      conditions.push(`(s.subscription_number ILIKE $${idx} OR c.name ILIKE $${idx} OR c.email ILIKE $${idx})`);
      params.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       ${whereClause}`,
      params,
      client
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    params.push(limit, offset);

    const res = await query<SubscriptionRow>(
      `SELECT s.*, 
              c.name as customer_name, c.email as customer_email,
              p.name as plan_name, p.period as plan_period, p.price as plan_price,
              p.closable as plan_closable, p.pausable as plan_pausable, p.renewable as plan_renewable, p.auto_close as plan_auto_close
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       ${whereClause}
       ORDER BY s.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
      client
    );

    return { subscriptions: res.rows, total };
  }

  async findSubscriptionById(id: string, client?: DbClient): Promise<SubscriptionRow | null> {
    const res = await query<SubscriptionRow>(
      `SELECT s.*, 
              c.name as customer_name, c.email as customer_email,
              p.name as plan_name, p.period as plan_period, p.price as plan_price,
              p.closable as plan_closable, p.pausable as plan_pausable, p.renewable as plan_renewable, p.auto_close as plan_auto_close
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       WHERE s.id = $1`,
      [id],
      client
    );

    const sub = res.rows[0];
    if (!sub) return null;

    const lineRes = await query<SubscriptionLineRow>(
      `SELECT sl.*, pr.name as product_name, pv.attribute as variant_attribute, pv.value as variant_value
       FROM subscription_lines sl
       JOIN products pr ON pr.id = sl.product_id
       LEFT JOIN product_variants pv ON pv.id = sl.variant_id
       WHERE sl.subscription_id = $1`,
      [id],
      client
    );
    sub.lines = lineRes.rows;

    return sub;
  }

  async createSubscription(
    data: {
      customerId: string;
      planId: string;
      startDate: string;
      expiryDate?: string;
      notes?: string;
      lines: Array<{ productId: string; variantId?: string | null; unitPrice: number; quantity: number }>;
    },
    client?: DbClient
  ): Promise<SubscriptionRow> {
    const id = crypto.randomUUID();
    const subNumber = await this.getNextSubscriptionNumber(client);

    const res = await query<SubscriptionRow>(
      `INSERT INTO subscriptions (
        id, subscription_number, customer_id, plan_id, status,
        start_date, expiry_date, notes, version
      ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, 1)
      RETURNING *`,
      [
        id,
        subNumber,
        data.customerId,
        data.planId,
        data.startDate,
        data.expiryDate ?? null,
        data.notes ?? null
      ],
      client
    );
    const sub = res.rows[0]!;

    for (const line of data.lines) {
      const lineId = crypto.randomUUID();
      await query(
        `INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lineId, id, line.productId, line.variantId ?? null, line.unitPrice, line.quantity],
        client
      );
    }

    return sub;
  }

  async updateSubscription(
    id: string,
    expectedVersion: number,
    data: {
      expiryDate?: string | null;
      notes?: string;
      lines?: Array<{ productId: string; variantId?: string | null; unitPrice: number; quantity: number }>;
    },
    client?: DbClient
  ): Promise<SubscriptionRow> {
    const res = await query<SubscriptionRow>(
      `UPDATE subscriptions
       SET expiry_date = CASE WHEN $1::boolean THEN $2::date ELSE expiry_date END,
           notes = COALESCE($3, notes),
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND version = $5
       RETURNING *`,
      [
        data.expiryDate !== undefined,
        data.expiryDate ?? null,
        data.notes ?? null,
        id,
        expectedVersion
      ],
      client
    );

    if (res.rows.length === 0) {
      throw new ConflictError(
        'Optimistic lock failure: Subscription was modified by another request. Please reload.'
      );
    }

    if (data.lines) {
      await query('DELETE FROM subscription_lines WHERE subscription_id = $1', [id], client);
      for (const line of data.lines) {
        const lineId = crypto.randomUUID();
        await query(
          `INSERT INTO subscription_lines (id, subscription_id, product_id, variant_id, unit_price, quantity)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [lineId, id, line.productId, line.variantId ?? null, line.unitPrice, line.quantity],
          client
        );
      }
    }

    return res.rows[0]!;
  }

  async updateSubscriptionStatus(
    id: string,
    expectedVersion: number,
    data: {
      status: SubStatus;
      nextBillingDate?: string | null;
      pausedUntil?: string | null;
    },
    client?: DbClient
  ): Promise<SubscriptionRow> {
    const res = await query<SubscriptionRow>(
      `UPDATE subscriptions
       SET status = $1,
           next_billing_date = CASE WHEN $2::boolean THEN $3::date ELSE next_billing_date END,
           paused_until = CASE WHEN $4::boolean THEN $5::date ELSE paused_until END,
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND version = $7
       RETURNING *`,
      [
        data.status,
        data.nextBillingDate !== undefined,
        data.nextBillingDate ?? null,
        data.pausedUntil !== undefined,
        data.pausedUntil ?? null,
        id,
        expectedVersion
      ],
      client
    );

    if (res.rows.length === 0) {
      throw new ConflictError(
        'Optimistic lock failure: Subscription was modified by another request. Please reload.'
      );
    }

    return res.rows[0]!;
  }

  async listExpiredSubscriptionsForAutoClose(client?: DbClient): Promise<SubscriptionRow[]> {
    const res = await query<SubscriptionRow>(
      `SELECT s.*, p.auto_close as plan_auto_close
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'active'
         AND s.expiry_date IS NOT NULL
         AND s.expiry_date < CURRENT_DATE
         AND p.auto_close = true`,
      [],
      client
    );
    return res.rows;
  }
}

export const subscriptionRepository = new SubscriptionRepository();
