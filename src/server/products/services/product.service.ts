// src/server/products/services/product.service.ts
import { IProductRepository } from '../repositories/product.repository.interface';
import { getProductRepository } from '../repositories/product.repository.provider';
import {
  ProductResponseDTO,
  ProductListItemDTO,
  CreateProductDTO,
  UpdateProductDTO,
  ProductListQuery,
} from '../dtos/product.dto';
import { ProductEntity } from '../types/product.types';
import { NotFoundError } from '../../utils/error';

/**
 * Product Service - Pure business logic.
 * Depends only on the IProductRepository interface.
 * Does NOT know whether we are using Supabase or the legacy SQLite adapter.
 */
export class ProductService {
  constructor(private readonly productRepository: IProductRepository = getProductRepository()) {}

  async getProductById(id: string, businessId: string): Promise<ProductResponseDTO> {
    const product = await this.productRepository.findById(id, businessId);

    if (!product) {
      throw new NotFoundError('Product');
    }

    return this.toResponseDTO(product);
  }

  async listProducts(businessId: string, query: ProductListQuery): Promise<{
    items: ProductListItemDTO[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const result = await this.productRepository.findAll(businessId, query);

    return {
      items: result.data.map((p: ProductEntity) => this.toListItemDTO(p)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    };
  }

  async createProduct(dto: CreateProductDTO, businessId: string, userId?: string): Promise<ProductResponseDTO> {
    // Business rules can be added here (e.g. SKU uniqueness check, price validation, etc.)
    const created = await this.productRepository.create(dto, businessId, userId);
    return this.toResponseDTO(created);
  }

  async updateProduct(id: string, dto: UpdateProductDTO, businessId: string): Promise<ProductResponseDTO> {
    const updated = await this.productRepository.update(id, dto, businessId);
    return this.toResponseDTO(updated);
  }

  async deleteProduct(id: string, businessId: string): Promise<void> {
    await this.productRepository.softDelete(id, businessId);
  }

  // === Mapping methods (private) ===

  private toResponseDTO(entity: ProductEntity): ProductResponseDTO {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description,
      sku: entity.sku,
      barcode: entity.barcode,
      price: entity.price,
      cost_price: entity.cost_price,
      stock_quantity: entity.stock_quantity,
      low_stock_threshold: entity.low_stock_threshold,
      image_url: entity.image_url,
      is_available: entity.is_available,
      is_featured: entity.is_featured,
      category_id: entity.category_id,
      sort_order: entity.sort_order,
      created_at: entity.created_at,
      updated_at: entity.updated_at,
    };
  }

  private toListItemDTO(entity: ProductEntity): ProductListItemDTO {
    return {
      id: entity.id,
      name: entity.name,
      price: entity.price,
      stock_quantity: entity.stock_quantity,
      is_available: entity.is_available,
      image_url: entity.image_url,
      is_featured: entity.is_featured,
      category_id: entity.category_id,
    };
  }

  // ==================== Sync-related methods (prepared for Sync Engine) ====================

  async getPendingSyncProducts(businessId: string, limit?: number): Promise<ProductEntity[]> {
    return this.productRepository.findPendingSync(businessId, limit);
  }

  async markProductsAsSynced(ids: string[], businessId: string): Promise<void> {
    return this.productRepository.markAsSynced(ids, businessId);
  }
}

// Singleton for now (will be replaced by proper DI container later)
export const productService = new ProductService();
