import { z } from 'zod';

export const createDiscountSchema = z.object({
  name: z.string().trim().min(1, 'Discount name is required'),
  code: z.string().trim().toUpperCase().optional(),
  type: z.enum(['fixed', 'percentage']),
  value: z.coerce.number().min(0.01, 'Discount value must be greater than 0'),
  scope: z.enum(['product', 'subscription']).default('subscription'),
  minPurchase: z.coerce.number().min(0).default(0),
  minQuantity: z.coerce.number().int().min(0).default(0),
  startDate: z.string().date('Start date must be YYYY-MM-DD'),
  endDate: z.string().date('End date must be YYYY-MM-DD'),
  usageLimit: z.coerce.number().int().min(1).optional(),
  productIds: z.array(z.string().uuid()).optional().default([]),
  subscriptionIds: z.array(z.string().uuid()).optional().default([]),
  isActive: z.boolean().default(true)
}).refine((d) => {
  if (d.type === 'percentage' && d.value > 100) {
    return false;
  }
  return true;
}, {
  message: 'Percentage discount cannot exceed 100%',
  path: ['value']
}).refine((d) => {
  return new Date(d.endDate) >= new Date(d.startDate);
}, {
  message: 'End date must be on or after start date',
  path: ['endDate']
});

export const updateDiscountSchema = z.object({
  name: z.string().trim().min(1).optional(),
  code: z.string().trim().toUpperCase().optional(),
  type: z.enum(['fixed', 'percentage']).optional(),
  value: z.coerce.number().min(0.01).optional(),
  scope: z.enum(['product', 'subscription']).optional(),
  minPurchase: z.coerce.number().min(0).optional(),
  minQuantity: z.coerce.number().int().min(0).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  usageLimit: z.coerce.number().int().min(1).nullable().optional(),
  productIds: z.array(z.string().uuid()).optional(),
  subscriptionIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional()
});

export type CreateDiscountInput = z.infer<typeof createDiscountSchema>;
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>;
