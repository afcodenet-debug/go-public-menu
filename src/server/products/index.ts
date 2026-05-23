// src/server/products/index.ts
// Barrel export for the Products domain module

export * from './types/product.types';
export * from './dtos/product.dto';
export * from './validators/product.validators';
export * from './repositories/product.repository.interface';
export * from './services/product.service';
export * from './controllers/product.controller';
export { default as productsRoutes } from './routes/products.routes';
