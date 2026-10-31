import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { createDiscountSchema, updateDiscountSchema } from './discounts.schema.js';
import { discountsRepository } from './discounts.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

export const discountsRouter = Router();

discountsRouter.use(requireAuth);

// 1. List Discounts (Admin, Staff)
discountsRouter.get('/', requireRole('admin', 'staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const discounts = await discountsRepository.listDiscounts();
    res.status(200).json({ data: discounts, meta: { total: discounts.length } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Discount (Admin only)
discountsRouter.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createDiscountSchema.parse(req.body);
    const discount = await discountsRepository.createDiscount(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'discount.created',
      entity: 'discounts',
      entityId: discount.id,
      afterState: discount
    });

    res.status(201).json({ data: discount, meta: { message: 'Discount created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 3. Update Discount (Admin only)
discountsRouter.patch('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updateDiscountSchema.parse(req.body);

    const current = await discountsRepository.findDiscountById(id);
    if (!current) {
      throw new NotFoundError('Discount not found');
    }

    const updated = await discountsRepository.updateDiscount(id, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'discount.updated',
      entity: 'discounts',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Discount updated successfully' } });
  } catch (err) {
    next(err);
  }
});

// 4. Delete Discount (Admin only)
discountsRouter.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await discountsRepository.findDiscountById(id);
    if (!current) {
      throw new NotFoundError('Discount not found');
    }

    await discountsRepository.deleteDiscount(id);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'discount.deleted',
      entity: 'discounts',
      entityId: id,
      beforeState: current
    });

    res.status(200).json({ data: null, meta: { message: 'Discount deleted successfully' } });
  } catch (err) {
    next(err);
  }
});
