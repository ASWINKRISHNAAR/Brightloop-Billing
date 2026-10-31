import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { customersRepository } from './customers.repository.js';
import { createCustomerSchema, updateCustomerSchema } from './customers.schema.js';
import { NotFoundError, ForbiddenError } from '../../common/errors.js';
import { authRepository } from '../auth/auth.repository.js';

export const customersRouter = Router();

customersRouter.use(requireAuth);

// 1. List customers (Admin & Staff)
customersRouter.get('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 20;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;
    const search = req.query['search'] as string | undefined;

    const { customers, total } = await customersRepository.listCustomers({ limit, offset, search });
    res.status(200).json({ data: customers, total, meta: { total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// 2. Get customer by ID
customersRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    if (req.user!.role === 'customer' && req.user!.customerId !== id) {
      throw new ForbiddenError('Access denied: You cannot view other customers');
    }

    const customer = await customersRepository.findCustomerById(id);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    res.status(200).json({ data: customer });
  } catch (err) {
    next(err);
  }
});

// 3. Create customer (Admin & Staff)
customersRouter.post('/', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createCustomerSchema.parse(req.body);
    const customer = await customersRepository.createCustomer(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'customer.created',
      entity: 'customers',
      entityId: customer.id,
      afterState: customer,
    });

    res.status(201).json({ data: customer, meta: { message: 'Customer created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 4. Update customer (Admin & Staff, or Customer updating own profile)
customersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    if (req.user!.role === 'customer' && req.user!.customerId !== id) {
      throw new ForbiddenError('Access denied: You cannot update other customers');
    }

    const input = updateCustomerSchema.parse(req.body);
    const updated = await customersRepository.updateCustomer(id, input);
    if (!updated) {
      throw new NotFoundError('Customer not found');
    }

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'customer.updated',
      entity: 'customers',
      entityId: id,
      afterState: updated,
    });

    res.status(200).json({ data: updated, meta: { message: 'Customer updated successfully' } });
  } catch (err) {
    next(err);
  }
});

