// src/server/products/dtos/product.dto.ts
// Strict separation between internal entities and what we expose via API

import { ProductEntity } from '../types/product.types';

/**
 * What the API returns to clients (never expose raw DB entity)
 */
export interface ProductResponseDTO {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  barcode: string | null;
  price: string;                    // Money as string (safe)
  cost_price: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  category_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Lightweight version for lists (QR Menu, POS grid, etc.)
 */
export interface ProductListItemDTO {
  id: string;
  name: string;
  price: string;
  stock_quantity: number;
  is_available: boolean;
  image_url: string | null;
  is_featured: boolean;
  category_id: string | null;
}

/**
 * Data needed to create a new product
 */
export interface CreateProductDTO {
  name: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price: string;                    // Required - must be valid decimal string
  cost_price?: string | null;
  stock_quantity?: number;
  low_stock_threshold?: number;
  image_url?: string | null;
  is_available?: boolean;
  is_featured?: boolean;
  category_id?: string | null;
  sort_order?: number;
  metadata?: Record<string, any> | null;
}

/**
 * Partial update
 */
export interface UpdateProductDTO {
  name?: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  price?: string;
  cost_price?: string | null;
  stock_quantity?: number;
  low_stock_threshold?: number;
  image_url?: string | null;
  is_available?: boolean;
  is_featured?: boolean;
  category_id?: string | null;
  sort_order?: number;
  metadata?: Record<string, any> | null;
}

/**
 * Query parameters for listing products
 */
export interface ProductListQuery {
  page?: number;
  limit?: number;
  search?: string;
  category_id?: string;
  is_available?: boolean;
  is_featured?: boolean;
  sort_by?: 'name' | 'price' | 'stock_quantity' | 'created_at' | 'sort_order';
  sort_order?: 'asc' | 'desc';
}
