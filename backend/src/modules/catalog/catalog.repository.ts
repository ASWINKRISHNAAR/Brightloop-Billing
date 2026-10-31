import crypto from 'crypto';
import { query, DbClient, withTransaction } from '../../db/pool.js';
import { TaxRow } from '../taxes/taxes.repository.js';

export interface ProductVariantRow {
  id: string;
  product_id: string;
  attribute: string;
  value: string;
  extra_price: string;
  is_active: boolean;
  created_at: Date;
}

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  base_price: string;
  is_active: boolean;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
  variants?: ProductVariantRow[];
  taxes?: TaxRow[];
}

export class CatalogRepository {
  async listProducts(
    options: {
      search?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    } = {},
    client?: DbClient
  ): Promise<{ products: ProductRow[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (!options.includeArchived) {
      conditions.push('p.is_archived = false');
    }

    if (options.search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
      params.push(`%${options.search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM products p ${whereClause}`,
      params,
      client
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    params.push(limit, offset);

    const res = await query<ProductRow>(
      `SELECT p.* FROM products p
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
      client
    );

    return { products: res.rows, total };
  }

  async findProductById(id: string, client?: DbClient): Promise<ProductRow | null> {
    const res = await query<ProductRow>('SELECT * FROM products WHERE id = $1', [id], client);
    const product = res.rows[0];
    if (!product) return null;

    // Fetch variants
    const varRes = await query<ProductVariantRow>(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY attribute, value',
      [id],
      client
    );
    product.variants = varRes.rows;

    // Fetch linked taxes
    const taxRes = await query<TaxRow>(
      `SELECT t.* FROM taxes t
       JOIN product_taxes pt ON pt.tax_id = t.id
       WHERE pt.product_id = $1`,
      [id],
      client
    );
    product.taxes = taxRes.rows;

    return product;
  }

  async createProduct(
    data: {
      name: string;
      description?: string;
      basePrice: number;
      taxIds?: string[];
      isActive?: boolean;
    }
  ): Promise<ProductRow> {
    return withTransaction(async (client) => {
      const id = crypto.randomUUID();
      const res = await query<ProductRow>(
        `INSERT INTO products (id, name, description, base_price, is_active)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, data.name, data.description ?? null, data.basePrice, data.isActive ?? true],
        client
      );
      const product = res.rows[0]!;

      if (data.taxIds && data.taxIds.length > 0) {
        for (const taxId of data.taxIds) {
          await query(
            'INSERT INTO product_taxes (product_id, tax_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, taxId],
            client
          );
        }
      }

      return product;
    });
  }

  async updateProduct(
    id: string,
    data: {
      name?: string;
      description?: string;
      basePrice?: number;
      taxIds?: string[];
      isActive?: boolean;
      isArchived?: boolean;
    }
  ): Promise<ProductRow | null> {
    return withTransaction(async (client) => {
      const current = await this.findProductById(id, client);
      if (!current) return null;

      const res = await query<ProductRow>(
        `UPDATE products
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             base_price = COALESCE($3, base_price),
             is_active = COALESCE($4, is_active),
             is_archived = COALESCE($5, is_archived),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [
          data.name ?? null,
          data.description ?? null,
          data.basePrice !== undefined ? data.basePrice : null,
          data.isActive !== undefined ? data.isActive : null,
          data.isArchived !== undefined ? data.isArchived : null,
          id
        ],
        client
      );

      if (data.taxIds !== undefined) {
        await query('DELETE FROM product_taxes WHERE product_id = $1', [id], client);
        for (const taxId of data.taxIds) {
          await query(
            'INSERT INTO product_taxes (product_id, tax_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, taxId],
            client
          );
        }
      }

      return res.rows[0] || null;
    });
  }

  async archiveProduct(id: string, client?: DbClient): Promise<ProductRow | null> {
    const res = await query<ProductRow>(
      `UPDATE products SET is_archived = true, is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING *`,
      [id],
      client
    );
    return res.rows[0] || null;
  }

  // Variants Repository Functions
  async listVariantsByProductId(productId: string, client?: DbClient): Promise<ProductVariantRow[]> {
    const res = await query<ProductVariantRow>(
      'SELECT * FROM product_variants WHERE product_id = $1 ORDER BY attribute, value',
      [productId],
      client
    );
    return res.rows;
  }

  async findVariantById(variantId: string, client?: DbClient): Promise<ProductVariantRow | null> {
    const res = await query<ProductVariantRow>(
      'SELECT * FROM product_variants WHERE id = $1',
      [variantId],
      client
    );
    return res.rows[0] || null;
  }

  async createVariant(
    productId: string,
    data: { attribute: string; value: string; extraPrice: number },
    client?: DbClient
  ): Promise<ProductVariantRow> {
    const id = crypto.randomUUID();
    const res = await query<ProductVariantRow>(
      `INSERT INTO product_variants (id, product_id, attribute, value, extra_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, productId, data.attribute, data.value, data.extraPrice],
      client
    );
    return res.rows[0]!;
  }

  async updateVariant(
    variantId: string,
    data: { attribute?: string; value?: string; extraPrice?: number; isActive?: boolean },
    client?: DbClient
  ): Promise<ProductVariantRow | null> {
    const res = await query<ProductVariantRow>(
      `UPDATE product_variants
       SET attribute = COALESCE($1, attribute),
           value = COALESCE($2, value),
           extra_price = COALESCE($3, extra_price),
           is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING *`,
      [
        data.attribute ?? null,
        data.value ?? null,
        data.extraPrice !== undefined ? data.extraPrice : null,
        data.isActive !== undefined ? data.isActive : null,
        variantId
      ],
      client
    );
    return res.rows[0] || null;
  }

  async deleteVariant(variantId: string, client?: DbClient): Promise<boolean> {
    const res = await query('DELETE FROM product_variants WHERE id = $1', [variantId], client);
    return (res.rowCount ?? 0) > 0;
  }
}

export const catalogRepository = new CatalogRepository();
