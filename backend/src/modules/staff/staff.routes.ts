import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { createStaffSchema } from '../auth/auth.schema.js';
import { authService } from '../auth/auth.service.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';
import { z } from 'zod';

export const staffRouter = Router();

// All staff endpoints require admin authentication
staffRouter.use(requireAuth, requireRole('admin'));

// 1. Create Staff
staffRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createStaffSchema.parse(req.body);
    const staffUser = await authService.createStaff(input, req.user!.userId);

    res.status(201).json({
      data: {
        id: staffUser.id,
        email: staffUser.email,
        name: staffUser.name,
        role: staffUser.role,
        isActive: staffUser.is_active,
        mustChangePassword: staffUser.must_change_password,
        createdAt: staffUser.created_at
      },
      meta: { message: 'Staff member created successfully' }
    });
  } catch (err) {
    next(err);
  }
});

// 2. List Staff
staffRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const staffList = await authRepository.listStaff();
    const data = staffList.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      isActive: s.is_active,
      mustChangePassword: s.must_change_password,
      lastLoginAt: s.last_login_at,
      createdAt: s.created_at
    }));

    res.status(200).json({ data, meta: { total: data.length } });
  } catch (err) {
    next(err);
  }
});

// 3. Update Staff Status (activate / deactivate)
staffRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updateSchema = z.object({
      isActive: z.boolean()
    });
    const { isActive } = updateSchema.parse(req.body);
    const updated = await authRepository.updateUserActiveStatus(req.params['id']!, isActive);

    if (!updated) {
      throw new NotFoundError('Staff user not found');
    }

    res.status(200).json({
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        isActive: updated.is_active
      },
      meta: { message: `Staff account ${isActive ? 'activated' : 'deactivated'}` }
    });
  } catch (err) {
    next(err);
  }
});
