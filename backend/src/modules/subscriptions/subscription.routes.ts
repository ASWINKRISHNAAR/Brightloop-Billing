import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  transitionSubscriptionSchema,
  pauseSubscriptionSchema,
  renewSubscriptionSchema
} from './subscription.schema.js';
import { subscriptionService } from './subscription.service.js';
import { subscriptionRepository } from './subscription.repository.js';
import { NotFoundError } from '../../common/errors.js';
import { SubStatus } from './subscription.stateMachine.js';

export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth);

// 1. List Subscriptions (Admin, Staff)
subscriptionRouter.get('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query['status'] as SubStatus | undefined;
    const customerId = req.query['customerId'] as string | undefined;
    const planId = req.query['planId'] as string | undefined;
    const search = req.query['search'] as string | undefined;
    const startDateFrom = req.query['startDateFrom'] as string | undefined;
    const startDateTo = req.query['startDateTo'] as string | undefined;
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;

    const result = await subscriptionRepository.listSubscriptions({
      status,
      customerId,
      planId,
      search,
      startDateFrom,
      startDateTo,
      limit,
      offset
    });

    res.status(200).json({ data: result.subscriptions, meta: { total: result.total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Subscription (Admin, Staff)
subscriptionRouter.post('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createSubscriptionSchema.parse(req.body);
    const sub = await subscriptionService.createSubscription(input, req.user!.userId);

    res.status(201).json({ data: sub, meta: { message: 'Subscription created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 3. Get Subscription by ID (Admin, Staff)
subscriptionRouter.get('/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sub = await subscriptionRepository.findSubscriptionById(req.params['id']!);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }
    res.status(200).json({ data: sub });
  } catch (err) {
    next(err);
  }
});

// 4. Update Subscription (Admin, Staff)
subscriptionRouter.patch('/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updateSubscriptionSchema.parse(req.body);

    const sub = await subscriptionRepository.findSubscriptionById(id);
    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    const updated = await subscriptionRepository.updateSubscription(id, input.version, {
      expiryDate: input.expiryDate,
      notes: input.notes,
      lines: input.lines ? input.lines.map((l) => ({
        productId: l.productId,
        variantId: l.variantId,
        unitPrice: l.unitPrice || 0,
        quantity: l.quantity
      })) : undefined
    });

    res.status(200).json({ data: updated, meta: { message: 'Subscription updated successfully' } });
  } catch (err) {
    next(err);
  }
});

// 5. State Machine Transition (Admin, Staff)
subscriptionRouter.post('/:id/transition', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const { to } = transitionSubscriptionSchema.parse(req.body);

    const updated = await subscriptionService.transitionStatus(id, to, req.user!.userId);
    res.status(200).json({ data: updated, meta: { message: `Subscription transitioned to ${to}` } });
  } catch (err) {
    next(err);
  }
});

// 6. Pause Subscription
subscriptionRouter.post('/:id/pause', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = pauseSubscriptionSchema.parse(req.body);

    const updated = await subscriptionService.pauseSubscription(id, input, req.user!.userId);
    res.status(200).json({ data: updated, meta: { message: `Subscription paused until ${input.pausedUntil}` } });
  } catch (err) {
    next(err);
  }
});

// 7. Resume Subscription
subscriptionRouter.post('/:id/resume', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const updated = await subscriptionService.resumeSubscription(id, req.user!.userId);
    res.status(200).json({ data: updated, meta: { message: 'Subscription resumed' } });
  } catch (err) {
    next(err);
  }
});

// 8. Renew Subscription
subscriptionRouter.post('/:id/renew', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = renewSubscriptionSchema.parse(req.body);

    const updated = await subscriptionService.renewSubscription(id, input, req.user!.userId);
    res.status(200).json({ data: updated, meta: { message: 'Subscription renewed' } });
  } catch (err) {
    next(err);
  }
});

// 9. Close Subscription
subscriptionRouter.post('/:id/close', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const updated = await subscriptionService.transitionStatus(id, 'closed', req.user!.userId);
    res.status(200).json({ data: updated, meta: { message: 'Subscription closed' } });
  } catch (err) {
    next(err);
  }
});
