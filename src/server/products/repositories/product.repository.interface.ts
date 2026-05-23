// src/server/products/repositories/product.repository.interface.ts
import { ProductEntity } from '../types/product.types';
import { CreateProductDTO, UpdateProductDTO, ProductListQuery } from '../dtos/product.dto';
import { PaginatedResult } from '../../types/common.types';
import { IProductSyncContract } from './product.sync.contract';

export interface IProductRepository extends IProductSyncContract {
  findById(id: string, businessId: string): Promise<ProductEntity | null>;
  findAll(businessId: string, query: ProductListQuery): Promise<PaginatedResult<ProductEntity>>;
  create(data: CreateProductDTO, businessId: string, createdBy?: string): Promise<ProductEntity>;
  update(id: string, data: UpdateProductDTO, businessId: string): Promise<ProductEntity>;
  softDelete(id: string, businessId: string): Promise<void>;
  findAvailableForMenu(businessId: string, categoryId?: string): Promise<ProductEntity[]>;
}
