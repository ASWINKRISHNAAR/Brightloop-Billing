import crypto from 'crypto';
import { query, DbClient, withTransaction } from '../../db/pool.js';

export interface QuotationTemplateLineRow {
  id: string;
  template_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product_name?: string;
  product_base_price?: string;
  variant_attribute?: string;
  variant_value?: string;
  variant_extra_price?: string;
}

export interface QuotationTemplateRow {
  id: string;
  name: string;
  description: string | null;
  plan_id: string;
  plan_name?: string;
  plan_price?: string;
  plan_period?: string;
  validity_days: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  lines?: QuotationTemplateLineRow[];
}

export class TemplatesRepository {
  async listTemplates(client?: DbClient): Promise<QuotationTemplateRow[]> {
    const res = await query<QuotationTemplateRow>(
      `SELECT t.*, p.name as plan_name, p.price as plan_price, p.period as plan_period
       FROM quotation_templates t
       JOIN plans p ON p.id = t.plan_id
       ORDER BY t.created_at DESC`,
      [],
      client
    );
    return res.rows;
  }

  async findTemplateById(id: string, client?: DbClient): Promise<QuotationTemplateRow | null> {
    const res = await query<QuotationTemplateRow>(
      `SELECT t.*, p.name as plan_name, p.price as plan_price, p.period as plan_period
       FROM quotation_templates t
       JOIN plans p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [id],
      client
    );
    const template = res.rows[0];
    if (!template) return null;

    const lineRes = await query<QuotationTemplateLineRow>(
      `SELECT qtl.*, pr.name as product_name, pr.base_price as product_base_price,
              pv.attribute as variant_attribute, pv.value as variant_value, pv.extra_price as variant_extra_price
       FROM quotation_template_lines qtl
       JOIN products pr ON pr.id = qtl.product_id
       LEFT JOIN product_variants pv ON pv.id = qtl.variant_id
       WHERE qtl.template_id = $1`,
      [id],
      client
    );
    template.lines = lineRes.rows;

    return template;
  }

  async createTemplate(data: {
    name: string;
    description?: string;
    planId: string;
    validityDays: number;
    lines: Array<{ productId: string; variantId?: string | null; quantity: number }>;
    isActive?: boolean;
  }): Promise<QuotationTemplateRow> {
    return withTransaction(async (client) => {
      const id = crypto.randomUUID();
      const res = await query<QuotationTemplateRow>(
        `INSERT INTO quotation_templates (id, name, description, plan_id, validity_days, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, data.name, data.description ?? null, data.planId, data.validityDays, data.isActive ?? true],
        client
      );
      const template = res.rows[0]!;

      for (const line of data.lines) {
        const lineId = crypto.randomUUID();
        await query(
          `INSERT INTO quotation_template_lines (id, template_id, product_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [lineId, id, line.productId, line.variantId ?? null, line.quantity],
          client
        );
      }

      return template;
    });
  }

  async updateTemplate(
    id: string,
    data: {
      name?: string;
      description?: string;
      planId?: string;
      validityDays?: number;
      lines?: Array<{ productId: string; variantId?: string | null; quantity: number }>;
      isActive?: boolean;
    }
  ): Promise<QuotationTemplateRow | null> {
    return withTransaction(async (client) => {
      const current = await this.findTemplateById(id, client);
      if (!current) return null;

      const res = await query<QuotationTemplateRow>(
        `UPDATE quotation_templates
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             plan_id = COALESCE($3, plan_id),
             validity_days = COALESCE($4, validity_days),
             is_active = COALESCE($5, is_active),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
        [
          data.name ?? null,
          data.description ?? null,
          data.planId ?? null,
          data.validityDays ?? null,
          data.isActive !== undefined ? data.isActive : null,
          id
        ],
        client
      );

      if (data.lines) {
        await query('DELETE FROM quotation_template_lines WHERE template_id = $1', [id], client);
        for (const line of data.lines) {
          const lineId = crypto.randomUUID();
          await query(
            `INSERT INTO quotation_template_lines (id, template_id, product_id, variant_id, quantity)
             VALUES ($1, $2, $3, $4, $5)`,
            [lineId, id, line.productId, line.variantId ?? null, line.quantity],
            client
          );
        }
      }

      return res.rows[0] || null;
    });
  }

  async deleteTemplate(id: string, client?: DbClient): Promise<boolean> {
    const res = await query('DELETE FROM quotation_templates WHERE id = $1', [id], client);
    return (res.rowCount ?? 0) > 0;
  }
}

export const templatesRepository = new TemplatesRepository();
