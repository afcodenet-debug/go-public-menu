// src/server/products/validators/product.validators.ts
import { z } from 'zod';

/**
 * Common money validator - accepts decimal strings like "12.50" or "100"
 */
const moneyString = z.string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a valid decimal amount (e.g. 12.50)')
  .refine((val) => parseFloat(val) >= 0, 'Price cannot be negative');

/**
 * Create Product
 */
export const createProductSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  description: z.string().max(1000).nullable().optional(),
  sku: z.string().max(50).nullable().optional(),
  barcode: z.string().max(50).nullable().optional(),
  price: moneyString,
  cost_price: moneyString.nullable().optional(),
  stock_quantity: z.number().int().min(0).default(0),
  low_stock_threshold: z.number().int().min(0).default(5),
  image_url: z.string().url().nullable().optional(),
  is_available: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  category_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().default(0),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
});

/**
 * Update Product
 */
export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    sku: z.string().max(50).nullable().optional(),
    barcode: z.string().max(50).nullable().optional(),
    price: moneyString.optional(),
    cost_price: moneyString.nullable().optional(),
    stock_quantity: z.number().int().min(0).optional(),
    low_stock_threshold: z.number().int().min(0).optional(),
    image_url: z.string().url().nullable().optional(),
    is_available: z.boolean().optional(),
    is_featured: z.boolean().optional(),
    category_id: z.string().uuid().nullable().optional(),
    sort_order: z.number().int().optional(),
    metadata: z.record(z.string(), z.any()).nullable().optional(),
  }),
});

/**
 * List products query
 */
export const listProductsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  category_id: z.string().uuid().optional(),
  is_available: z.coerce.boolean().optional(),
  is_featured: z.coerce.boolean().optional(),
  sort_by: z.enum(['name', 'price', 'stock_quantity', 'created_at', 'sort_order']).default('sort_order'),
  sort_order: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>['body'];
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
