import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../../common/authMiddleware.js';
import {
  createProductSchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema
} from './catalog.schema.js';
import { catalogRepository } from './catalog.repository.js';
import { authRepository } from '../auth/auth.repository.js';
import { NotFoundError } from '../../common/errors.js';

export const catalogRouter = Router();

catalogRouter.use(requireAuth);

// 1. List Products
catalogRouter.get('/products', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = req.query['search'] as string | undefined;
    const includeArchived = req.query['includeArchived'] === 'true';
    const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
    const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;

    const result = await catalogRepository.listProducts({ search, includeArchived, limit, offset });
    res.status(200).json({ data: result.products, meta: { total: result.total, limit, offset } });
  } catch (err) {
    next(err);
  }
});

// 2. Create Product (Admin only)
catalogRouter.post('/products', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createProductSchema.parse(req.body);
    const product = await catalogRepository.createProduct(input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product.created',
      entity: 'products',
      entityId: product.id,
      afterState: product
    });

    res.status(201).json({ data: product, meta: { message: 'Product created successfully' } });
  } catch (err) {
    next(err);
  }
});

// 3. Get Product by ID
catalogRouter.get('/products/:id', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await catalogRepository.findProductById(req.params['id']!);
    if (!product) {
      throw new NotFoundError('Product not found');
    }
    res.status(200).json({ data: product });
  } catch (err) {
    next(err);
  }
});

// 4. Update Product (Admin only)
catalogRouter.patch('/products/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const input = updateProductSchema.parse(req.body);
    const current = await catalogRepository.findProductById(id);
    if (!current) {
      throw new NotFoundError('Product not found');
    }

    const updated = await catalogRepository.updateProduct(id, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product.updated',
      entity: 'products',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Product updated successfully' } });
  } catch (err) {
    next(err);
  }
});

// 5. Archive Product (Admin only)
catalogRouter.post('/products/:id/archive', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await catalogRepository.findProductById(id);
    if (!current) {
      throw new NotFoundError('Product not found');
    }

    const archived = await catalogRepository.archiveProduct(id);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product.archived',
      entity: 'products',
      entityId: id,
      beforeState: current,
      afterState: archived
    });

    res.status(200).json({ data: archived, meta: { message: 'Product archived successfully' } });
  } catch (err) {
    next(err);
  }
});

// 6. List Variants for Product
catalogRouter.get('/products/:id/variants', requireRole('admin', 'staff'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const variants = await catalogRepository.listVariantsByProductId(req.params['id']!);
    res.status(200).json({ data: variants, meta: { total: variants.length } });
  } catch (err) {
    next(err);
  }
});

// 7. Create Variant for Product (Admin only)
catalogRouter.post('/products/:id/variants', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = req.params['id']!;
    const product = await catalogRepository.findProductById(productId);
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    const input = createVariantSchema.parse(req.body);
    const variant = await catalogRepository.createVariant(productId, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product_variant.created',
      entity: 'product_variants',
      entityId: variant.id,
      afterState: variant
    });

    res.status(201).json({ data: variant, meta: { message: 'Product variant created' } });
  } catch (err) {
    next(err);
  }
});

// 8. Update Variant (Admin only)
catalogRouter.patch('/variants/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await catalogRepository.findVariantById(id);
    if (!current) {
      throw new NotFoundError('Product variant not found');
    }

    const input = updateVariantSchema.parse(req.body);
    const updated = await catalogRepository.updateVariant(id, input);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product_variant.updated',
      entity: 'product_variants',
      entityId: id,
      beforeState: current,
      afterState: updated
    });

    res.status(200).json({ data: updated, meta: { message: 'Product variant updated' } });
  } catch (err) {
    next(err);
  }
});

// 9. Delete Variant (Admin only)
catalogRouter.delete('/variants/:id', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params['id']!;
    const current = await catalogRepository.findVariantById(id);
    if (!current) {
      throw new NotFoundError('Product variant not found');
    }

    await catalogRepository.deleteVariant(id);

    await authRepository.writeAuditLog({
      userId: req.user!.userId,
      action: 'product_variant.deleted',
      entity: 'product_variants',
      entityId: id,
      beforeState: current
    });

    res.status(200).json({ data: null, meta: { message: 'Product variant deleted' } });
  } catch (err) {
    next(err);
  }
});
