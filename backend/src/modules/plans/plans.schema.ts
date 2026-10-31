import { z } from 'zod';

export const createPlanSchema = z.object({
  name: z.string().trim().min(1, 'Plan name is required'),
  description: z.string().trim().optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  price: z.coerce.number().min(0, 'Plan price cannot be negative'),
  minQuantity: z.coerce.number().int().min(1, 'Minimum quantity must be at least 1').default(1),
  availableFrom: z.string().date().optional(),
  availableTo: z.string().date().optional(),
  autoClose: z.boolean().default(false),
  closable: z.boolean().default(true),
  pausable: z.boolean().default(true),
  renewable: z.boolean().default(true),
  isActive: z.boolean().default(true)
}).refine((data) => {
  if (data.availableFrom && data.availableTo) {
    return new Date(data.availableTo) >= new Date(data.availableFrom);
  }
  return true;
}, {
  message: 'availableTo date must be on or after availableFrom date',
  path: ['availableTo']
});

export const updatePlanSchema = z.object({
  version: z.coerce.number().int().min(1, 'Current plan version is required for optimistic locking'),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  price: z.coerce.number().min(0).optional(),
  minQuantity: z.coerce.number().int().min(1).optional(),
  availableFrom: z.string().date().nullable().optional(),
  availableTo: z.string().date().nullable().optional(),
  autoClose: z.boolean().optional(),
  closable: z.boolean().optional(),
  pausable: z.boolean().optional(),
  renewable: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
