import { z } from 'zod';

export const subscriptionLineSchema = z.object({
  productId: z.string().uuid('Valid product UUID required'),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').default(1),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').optional() // if omitted, snapshotted from product + variant
});

export const createSubscriptionSchema = z.object({
  customerId: z.string().uuid('Valid customer UUID required'),
  planId: z.string().uuid('Valid plan UUID required'),
  startDate: z.string().date('Start date must be in YYYY-MM-DD format'),
  expiryDate: z.string().date().optional(),
  notes: z.string().trim().optional(),
  templateId: z.string().uuid().optional(),
  lines: z.array(subscriptionLineSchema).optional().default([])
}).refine((data) => {
  if (data.expiryDate && data.startDate) {
    return new Date(data.expiryDate) >= new Date(data.startDate);
  }
  return true;
}, {
  message: 'Expiry date must be on or after start date',
  path: ['expiryDate']
});

export const updateSubscriptionSchema = z.object({
  version: z.coerce.number().int().min(1, 'Current version is required for optimistic locking'),
  expiryDate: z.string().date().nullable().optional(),
  notes: z.string().trim().optional(),
  lines: z.array(subscriptionLineSchema).optional()
});

export const transitionSubscriptionSchema = z.object({
  to: z.enum(['draft', 'quotation', 'confirmed', 'active', 'closed'])
});

export const pauseSubscriptionSchema = z.object({
  pausedUntil: z.string().date('Paused until date must be in YYYY-MM-DD format')
});

export const renewSubscriptionSchema = z.object({
  newExpiryDate: z.string().date().optional()
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type TransitionSubscriptionInput = z.infer<typeof transitionSubscriptionSchema>;
export type PauseSubscriptionInput = z.infer<typeof pauseSubscriptionSchema>;
export type RenewSubscriptionInput = z.infer<typeof renewSubscriptionSchema>;
