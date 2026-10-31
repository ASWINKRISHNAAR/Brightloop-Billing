import { z } from 'zod';

export const createTaxSchema = z.object({
  name: z.string().trim().min(1, 'Tax name is required'),
  rate: z.coerce.number().min(0, 'Tax rate cannot be negative').max(100, 'Tax rate cannot exceed 100%'),
  description: z.string().trim().optional(),
  isActive: z.boolean().default(true)
});

export const updateTaxSchema = z.object({
  name: z.string().trim().min(1).optional(),
  rate: z.coerce.number().min(0).max(100).optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean().optional()
});

export type CreateTaxInput = z.infer<typeof createTaxSchema>;
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;
