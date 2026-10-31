import crypto from 'crypto';
import { query, DbClient } from '../../db/pool.js';

export interface TaxRow {
  id: string;
  name: string;
  rate: string; // numeric in pg
  description: string | null;
  is_active: boolean;
  created_at: Date;
}

export class TaxesRepository {
  async listTaxes(onlyActive = false, client?: DbClient): Promise<TaxRow[]> {
    let sql = 'SELECT * FROM taxes';
    const params: any[] = [];
    if (onlyActive) {
      sql += ' WHERE is_active = true';
    }
    sql += ' ORDER BY created_at ASC';
    const res = await query<TaxRow>(sql, params, client);
    return res.rows;
  }

  async findTaxById(id: string, client?: DbClient): Promise<TaxRow | null> {
    const res = await query<TaxRow>('SELECT * FROM taxes WHERE id = $1', [id], client);
    return res.rows[0] || null;
  }

  async createTax(data: { name: string; rate: number; description?: string; isActive?: boolean }, client?: DbClient): Promise<TaxRow> {
    const id = crypto.randomUUID();
    const res = await query<TaxRow>(
      `INSERT INTO taxes (id, name, rate, description, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, data.name, data.rate, data.description ?? null, data.isActive ?? true],
      client
    );
    return res.rows[0]!;
  }

  async updateTax(id: string, data: { name?: string; rate?: number; description?: string; isActive?: boolean }, client?: DbClient): Promise<TaxRow | null> {
    const current = await this.findTaxById(id, client);
    if (!current) return null;

    const res = await query<TaxRow>(
      `UPDATE taxes
       SET name = COALESCE($1, name),
           rate = COALESCE($2, rate),
           description = COALESCE($3, description),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING *`,
      [
        data.name ?? null,
        data.rate !== undefined ? data.rate : null,
        data.description ?? null,
        data.isActive !== undefined ? data.isActive : null,
        id
      ],
      client
    );
    return res.rows[0] || null;
  }
}

export const taxesRepository = new TaxesRepository();
