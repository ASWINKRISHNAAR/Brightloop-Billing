import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import { createTemplateSchema, updateTemplateSchema } from './templates.schema.js';
import { templatesRepository } from './templates.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

export const templatesRouter = Router();

templatesRouter.use(requireAuth);

// 1. List Templates
templatesRouter.get('/', requireRole('admin', 'staff'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const templates = await templatesRepository.listTemplates();
    res.status(200).json({ data: templates, meta: { total: templates.length } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Template (Admin only)
templatesRouter.post('/', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createTemplateSchema.parse(req.body);
    const template = await templatesRepository.createTemplate(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'template.created',
      entity: 'quotation_templates',
      entityId: template.id,
      afterState: template
    });

    res.status(201).json({ data: template, meta: { message: 'Quotation template created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 3. Get Template by ID
templatesRouter.get('/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const template = await templatesRepository.findTemplateById(req.params['id']!);
    if (!template) {
      throw new NotFoundError('Quotation template not found');
    }
    res.status(200).json({ data: template });
  } catch (err) {
    next(err);
  }
});

// 4. Update Template (Admin only)
templatesRouter.patch('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updateTemplateSchema.parse(req.body);

    const current = await templatesRepository.findTemplateById(id);
    if (!current) {
      throw new NotFoundError('Quotation template not found');
    }

    const updated = await templatesRepository.updateTemplate(id, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'template.updated',
      entity: 'quotation_templates',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Quotation template updated successfully' } });
  } catch (err) {
    next(err);
  }
});

// 5. Delete Template (Admin only)
templatesRouter.delete('/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await templatesRepository.findTemplateById(id);
    if (!current) {
      throw new NotFoundError('Quotation template not found');
    }

    await templatesRepository.deleteTemplate(id);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'template.deleted',
      entity: 'quotation_templates',
      entityId: id,
      beforeState: current
    });

    res.status(200).json({ data: null, meta: { message: 'Quotation template deleted' } });
  } catch (err) {
    next(err);
  }
});
