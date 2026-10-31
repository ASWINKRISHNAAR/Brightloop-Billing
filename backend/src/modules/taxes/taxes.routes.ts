import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { createTaxSchema, updateTaxSchema } from './taxes.schema.js';
import { taxesRepository } from './taxes.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

export const taxesRouter = Router();

// Base protection: all tax endpoints require auth
taxesRouter.use(requireAuth);

// 1. List Taxes (Admin, Staff)
taxesRouter.get('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const onlyActive = req.query['active'] === 'true';
    const taxes = await taxesRepository.listTaxes(onlyActive);
    res.status(200).json({ data: taxes, meta: { total: taxes.length } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Tax (Admin only)
taxesRouter.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createTaxSchema.parse(req.body);
    const tax = await taxesRepository.createTax(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'tax.created',
      entity: 'taxes',
      entityId: tax.id,
      afterState: tax
    });

    res.status(201).json({ data: tax, meta: { message: 'Tax rule created' } });
  } catch (err) {
    next(err);
  }
});

// 3. Update Tax (Admin only)
taxesRouter.patch('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updateTaxSchema.parse(req.body);
    const current = await taxesRepository.findTaxById(id);
    if (!current) {
      throw new NotFoundError('Tax rule not found');
    }

    const updated = await taxesRepository.updateTax(id, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'tax.updated',
      entity: 'taxes',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Tax rule updated' } });
  } catch (err) {
    next(err);
  }
});
