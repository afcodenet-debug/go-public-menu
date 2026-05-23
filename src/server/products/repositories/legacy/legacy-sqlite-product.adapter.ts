// src/server/products/repositories/legacy/legacy-sqlite-product.adapter.ts
import Database from 'better-sqlite3';
import { IProductRepository } from '../product.repository.interface';
import { ProductEntity } from '../../types/product.types';
import { CreateProductDTO, UpdateProductDTO, ProductListQuery } from '../../dtos/product.dto';
import { PaginatedResult } from '../../../types/common.types';
import db from '../../../db/database'; // singleton existant
import { DatabaseError } from '../../../utils/error';

/**
 * TEMPORARY ADAPTER - Allows gradual migration from SQLite to Supabase.
 * This class wraps the old better-sqlite3 logic so the Service layer stays clean.
 * It will be removed once the full migration to Supabase is complete.
 */
export class LegacySQLiteProductAdapter implements IProductRepository {
  private readonly db: Database.Database;

  constructor(dbInstance?: Database.Database) {
    this.db = dbInstance ?? db;
  }

  findById(id: string, businessId: string): Promise<ProductEntity | null> {
    try {
      const row = this.db.prepare(`
        SELECT * FROM products 
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      `).get(id, businessId);

      return Promise.resolve(row ? this.mapRowToEntity(row) : null);
    } catch (error: any) {
      throw new DatabaseError(`Legacy findById failed: ${error.message}`);
    }
  }

  findAll(businessId: string, query: ProductListQuery): Promise<PaginatedResult<ProductEntity>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    let where = `WHERE business_id = ? AND deleted_at IS NULL`;
    const params: any[] = [businessId];

    if (query.search) {
      where += ` AND name LIKE ?`;
      params.push(`%${query.search}%`);
    }
    if (query.category_id) {
      where += ` AND category_id = ?`;
      params.push(query.category_id);
    }
    if (query.is_available !== undefined) {
      where += ` AND is_available = ?`;
      params.push(query.is_available ? 1 : 0);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM products ${where}`).get(...params) as { total: number };
    const rows = this.db.prepare(`
      SELECT * FROM products ${where}
      ORDER BY sort_order ASC, name ASC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return Promise.resolve({
      data: rows.map((r: any) => this.mapRowToEntity(r)),
      total: countRow.total,
      page,
      limit,
      hasMore: (offset + limit) < countRow.total,
    });
  }

  // For the legacy path we keep the old behavior (no UUID generation here for now)
  create(data: CreateProductDTO, businessId: string): Promise<ProductEntity> {
    throw new Error('Create via legacy adapter is disabled during migration. Use Supabase path.');
  }

  update(id: string, data: UpdateProductDTO, businessId: string): Promise<ProductEntity> {
    throw new Error('Update via legacy adapter is disabled during migration.');
  }

  softDelete(id: string, businessId: string): Promise<void> {
    try {
      this.db.prepare(`
        UPDATE products 
        SET deleted_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(id, businessId);
      return Promise.resolve();
    } catch (error: any) {
      throw new DatabaseError(`Legacy soft delete failed: ${error.message}`);
    }
  }

  findAvailableForMenu(businessId: string, categoryId?: string): Promise<ProductEntity[]> {
    let sql = `
      SELECT * FROM products 
      WHERE business_id = ? AND deleted_at IS NULL AND is_available = 1
    `;
    const params: any[] = [businessId];

    if (categoryId) {
      sql += ` AND category_id = ?`;
      params.push(categoryId);
    }

    sql += ` ORDER BY sort_order ASC, name ASC`;

    const rows = this.db.prepare(sql).all(...params);
    return Promise.resolve(rows.map((r: any) => this.mapRowToEntity(r)));
  }

  // Internal mapper - converts old SQLite row to our new Entity shape
  private mapRowToEntity(row: any): ProductEntity {
    return {
      id: String(row.id),
      business_id: row.business_id || 'legacy-business',
      branch_id: row.branch_id || null,
      category_id: row.category_id ? String(row.category_id) : null,
      name: row.name,
      description: row.description,
      sku: row.sku,
      barcode: row.barcode,
      price: String(row.price ?? row.selling_price ?? 0),
      cost_price: row.cost_price ? String(row.cost_price) : null,
      stock_quantity: Number(row.stock_quantity ?? 0),
      low_stock_threshold: Number(row.low_stock_threshold ?? 5),
      image_url: row.image_url,
      is_available: Boolean(row.is_available ?? row.is_active),
      is_featured: Boolean(row.is_featured ?? false),
      sort_order: Number(row.sort_order ?? 0),
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      version: Number(row.version ?? 1),
      sync_status: 'synced',
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    };
  }

  // ==================== Sync Contract (stub for legacy) ====================

  async findPendingSync(businessId: string, limit = 100): Promise<ProductEntity[]> {
    // In legacy mode during migration, we consider everything "synced"
    return [];
  }

  async markAsSynced(ids: string[], businessId: string): Promise<void> {
    // No-op in pure legacy mode
  }

  async getDeltaSince(businessId: string, since: string): Promise<ProductEntity[]> {
    // For legacy, we can return recent changes if needed
    return [];
  }

  async findByIdWithVersion(id: string, businessId: string): Promise<{ id: string; version: number; updated_at: string } | null> {
    const product = await this.findById(id, businessId);
    if (!product) return null;
    return {
      id: product.id,
      version: product.version,
      updated_at: product.updated_at,
    };
  }
}
