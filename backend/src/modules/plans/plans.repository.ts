import crypto from 'crypto';
import { query, DbClient } from '../../db/pool.js';
import { ConflictError } from '../../common/errors.js';

export interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  price: string;
  min_quantity: number;
  available_from: string | null;
  available_to: string | null;
  auto_close: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export class PlansRepository {
  async listPlans(onlyActive = false, client?: DbClient): Promise<PlanRow[]> {
    let sql = 'SELECT * FROM plans';
    const params: any[] = [];
    if (onlyActive) {
      sql += ' WHERE is_active = true';
    }
    sql += ' ORDER BY created_at ASC';
    const res = await query<PlanRow>(sql, params, client);
    return res.rows;
  }

  async findPlanById(id: string, client?: DbClient): Promise<PlanRow | null> {
    const res = await query<PlanRow>('SELECT * FROM plans WHERE id = $1', [id], client);
    return res.rows[0] || null;
  }

  async createPlan(
    data: {
      name: string;
      description?: string;
      period: 'daily' | 'weekly' | 'monthly' | 'yearly';
      price: number;
      minQuantity: number;
      availableFrom?: string;
      availableTo?: string;
      autoClose?: boolean;
      closable?: boolean;
      pausable?: boolean;
      renewable?: boolean;
      isActive?: boolean;
    },
    client?: DbClient
  ): Promise<PlanRow> {
    const id = crypto.randomUUID();
    const res = await query<PlanRow>(
      `INSERT INTO plans (
        id, name, description, period, price, min_quantity,
        available_from, available_to, auto_close, closable, pausable, renewable,
        is_active, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
      RETURNING *`,
      [
        id,
        data.name,
        data.description ?? null,
        data.period,
        data.price,
        data.minQuantity,
        data.availableFrom ?? null,
        data.availableTo ?? null,
        data.autoClose ?? false,
        data.closable ?? true,
        data.pausable ?? true,
        data.renewable ?? true,
        data.isActive ?? true
      ],
      client
    );
    return res.rows[0]!;
  }

  async updatePlanWithOptimisticLock(
    id: string,
    expectedVersion: number,
    data: {
      name?: string;
      description?: string;
      period?: 'daily' | 'weekly' | 'monthly' | 'yearly';
      price?: number;
      minQuantity?: number;
      availableFrom?: string | null;
      availableTo?: string | null;
      autoClose?: boolean;
      closable?: boolean;
      pausable?: boolean;
      renewable?: boolean;
      isActive?: boolean;
    },
    client?: DbClient
  ): Promise<PlanRow> {
    const res = await query<PlanRow>(
      `UPDATE plans
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           period = COALESCE($3, period),
           price = COALESCE($4, price),
           min_quantity = COALESCE($5, min_quantity),
           available_from = CASE WHEN $6::boolean THEN $7::date ELSE available_from END,
           available_to = CASE WHEN $8::boolean THEN $9::date ELSE available_to END,
           auto_close = COALESCE($10, auto_close),
           closable = COALESCE($11, closable),
           pausable = COALESCE($12, pausable),
           renewable = COALESCE($13, renewable),
           is_active = COALESCE($14, is_active),
           version = version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $15 AND version = $16
       RETURNING *`,
      [
        data.name ?? null,
        data.description ?? null,
        data.period ?? null,
        data.price !== undefined ? data.price : null,
        data.minQuantity !== undefined ? data.minQuantity : null,
        data.availableFrom !== undefined,
        data.availableFrom ?? null,
        data.availableTo !== undefined,
        data.availableTo ?? null,
        data.autoClose !== undefined ? data.autoClose : null,
        data.closable !== undefined ? data.closable : null,
        data.pausable !== undefined ? data.pausable : null,
        data.renewable !== undefined ? data.renewable : null,
        data.isActive !== undefined ? data.isActive : null,
        id,
        expectedVersion
      ],
      client
    );

    if (res.rows.length === 0) {
      throw new ConflictError(
        'Optimistic lock failure: The plan has been modified by another request. Please reload and try again.'
      );
    }

    return res.rows[0]!;
  }
}

export const plansRepository = new PlansRepository();
