import { z } from 'zod';

export const templateLineSchema = z.object({
  productId: z.string().uuid('Valid product UUID required'),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').default(1)
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required'),
  description: z.string().trim().optional(),
  planId: z.string().uuid('Valid plan UUID required'),
  validityDays: z.coerce.number().int().min(1, 'Validity days must be at least 1').default(30),
  lines: z.array(templateLineSchema).min(1, 'At least one product line is required'),
  isActive: z.boolean().default(true)
});

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  planId: z.string().uuid().optional(),
  validityDays: z.coerce.number().int().min(1).optional(),
  lines: z.array(templateLineSchema).optional(),
  isActive: z.boolean().optional()
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type TemplateLineInput = z.infer<typeof templateLineSchema>;
