// src/server/products/routes/products.routes.ts
import { Router } from 'express';
import { productController } from '../controllers/product.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
// Validators temporarily disabled for first working endpoint
// import { listProductsQuerySchema, updateProductSchema } from '../validators/product.validators';
// import { validate } from '../../middleware/validate.middleware';

const router = Router();

/**
 * All product routes are protected and require business context.
 * Feature flag USE_SUPABASE_PRODUCTS decides whether we hit the new Supabase path or legacy.
 */

// GET /api/v1/products
router.get(
  '/',
  authMiddleware,
  productController.getProducts.bind(productController)
);

// GET /api/v1/products/:id
router.get(
  '/:id',
  authMiddleware,
  productController.getProductById.bind(productController)
);

// POST /api/v1/products (admin only - will add role check later)
router.post(
  '/',
  authMiddleware,
  productController.createProduct.bind(productController)
);

// PATCH /api/v1/products/:id
router.patch(
  '/:id',
  authMiddleware,
  productController.updateProduct.bind(productController)
);

// DELETE /api/v1/products/:id
router.delete(
  '/:id',
  authMiddleware,
  productController.deleteProduct.bind(productController)
);

export default router;
