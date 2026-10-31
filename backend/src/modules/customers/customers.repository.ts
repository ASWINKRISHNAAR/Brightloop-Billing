import { query } from '../../db/pool.js';
import { CreateCustomerInput, UpdateCustomerInput } from './customers.schema.js';
import { v4 as uuidv4 } from 'uuid';

export interface CustomerRow {
  id: string;
  user_id?: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class CustomersRepository {
  async listCustomers(params: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<{ customers: CustomerRow[]; total: number }> {
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (params.search && params.search.trim() !== '') {
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR company ILIKE $${idx})`);
      values.push(`%${params.search.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM customers ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listSql = `
      SELECT * FROM customers
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(limit, offset);

    const listRes = await query<CustomerRow>(listSql, values);
    return { customers: listRes.rows, total };
  }

  async findCustomerById(id: string): Promise<CustomerRow | null> {
    const res = await query<CustomerRow>('SELECT * FROM customers WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async findCustomerByUserId(userId: string): Promise<CustomerRow | null> {
    const res = await query<CustomerRow>('SELECT * FROM customers WHERE user_id = $1', [userId]);
    return res.rows[0] || null;
  }

  async createCustomer(input: CreateCustomerInput, userId?: string): Promise<CustomerRow> {
    const id = uuidv4();
    const res = await query<CustomerRow>(
      `INSERT INTO customers (
        id, user_id, name, email, phone, company, address_line1, address_line2,
        city, state, postal_code, country, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
      RETURNING *`,
      [
        id,
        userId || null,
        input.name,
        input.email.toLowerCase().trim(),
        input.phone || null,
        input.company || null,
        input.address_line1 || null,
        input.address_line2 || null,
        input.city || null,
        input.state || null,
        input.postal_code || null,
        input.country || 'US',
      ]
    );
    return res.rows[0]!;
  }

  async updateCustomer(id: string, input: UpdateCustomerInput): Promise<CustomerRow | null> {
    const current = await this.findCustomerById(id);
    if (!current) return null;

    const res = await query<CustomerRow>(
      `UPDATE customers SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        phone = COALESCE($3, phone),
        company = COALESCE($4, company),
        address_line1 = COALESCE($5, address_line1),
        address_line2 = COALESCE($6, address_line2),
        city = COALESCE($7, city),
        state = COALESCE($8, state),
        postal_code = COALESCE($9, postal_code),
        country = COALESCE($10, country),
        is_active = COALESCE($11, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *`,
      [
        input.name ?? null,
        input.email ? input.email.toLowerCase().trim() : null,
        input.phone ?? null,
        input.company ?? null,
        input.address_line1 ?? null,
        input.address_line2 ?? null,
        input.city ?? null,
        input.state ?? null,
        input.postal_code ?? null,
        input.country ?? null,
        input.is_active ?? null,
        id,
      ]
    );
    return res.rows[0] || null;
  }
}

export const customersRepository = new CustomersRepository();

