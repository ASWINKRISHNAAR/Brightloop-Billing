import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  description: z.string().trim().optional(),
  basePrice: z.coerce.number().min(0, 'Base price cannot be negative'),
  taxIds: z.array(z.string().uuid()).optional().default([]),
  isActive: z.boolean().default(true)
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  basePrice: z.coerce.number().min(0).optional(),
  taxIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional()
});

export const createVariantSchema = z.object({
  attribute: z.string().trim().min(1, 'Attribute name is required (e.g., Brand, Color, Tier)'),
  value: z.string().trim().min(1, 'Attribute value is required (e.g., Odoo, Blue, Enterprise)'),
  extraPrice: z.coerce.number().min(0, 'Extra price cannot be negative').default(0)
});

export const updateVariantSchema = z.object({
  attribute: z.string().trim().min(1).optional(),
  value: z.string().trim().min(1).optional(),
  extraPrice: z.coerce.number().min(0).optional(),
  isActive: z.boolean().optional()
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
