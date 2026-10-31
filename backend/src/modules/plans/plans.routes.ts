import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { createPlanSchema, updatePlanSchema } from './plans.schema.js';
import { plansRepository } from './plans.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

export const plansRouter = Router();

plansRouter.use(requireAuth);

// 1. List Plans
plansRouter.get('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const onlyActive = req.query['active'] === 'true';
    const plans = await plansRepository.listPlans(onlyActive);
    res.status(200).json({ data: plans, meta: { total: plans.length } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Plan (Admin only)
plansRouter.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createPlanSchema.parse(req.body);
    const plan = await plansRepository.createPlan(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'plan.created',
      entity: 'plans',
      entityId: plan.id,
      afterState: plan
    });

    res.status(201).json({ data: plan, meta: { message: 'Plan created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 3. Get Plan by ID
plansRouter.get('/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plan = await plansRepository.findPlanById(req.params['id']!);
    if (!plan) {
      throw new NotFoundError('Plan not found');
    }
    res.status(200).json({ data: plan });
  } catch (err) {
    next(err);
  }
});

// 4. Update Plan with Optimistic Locking (Admin only)
plansRouter.patch('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updatePlanSchema.parse(req.body);

    const current = await plansRepository.findPlanById(id);
    if (!current) {
      throw new NotFoundError('Plan not found');
    }

    const updated = await plansRepository.updatePlanWithOptimisticLock(id, input.version, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'plan.updated',
      entity: 'plans',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Plan updated successfully' } });
  } catch (err) {
    next(err);
  }
});

// 5. Close / Deactivate Plan (Admin only)
plansRouter.post('/:id/close', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await plansRepository.findPlanById(id);
    if (!current) {
      throw new NotFoundError('Plan not found');
    }

    const updated = await plansRepository.updatePlanWithOptimisticLock(id, current.version, { isActive: false });

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'plan.closed',
      entity: 'plans',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Plan closed / deactivated' } });
  } catch (err) {
    next(err);
  }
});
