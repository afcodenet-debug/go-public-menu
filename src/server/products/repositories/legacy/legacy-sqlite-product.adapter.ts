import { db } from '../../../db/database';
import { IProductRepository } from '../product.repository.interface';
import { ProductEntity } from '../../types/product.types';

function forensicLog(label: string, err: any, sql?: string, params?: any[]) {
  console.error(`[PRODUCTS REPO FORENSIC ERROR] ${label}`, {
    message: err?.message,
    sqliteCode: err?.code || err?.errno || 'N/A',
    stack: err?.stack?.split('\n').slice(0, 6).join('\n'),
    sql: sql || 'N/A',
    params: params || [],
    dbIsNull: !db
  });
}

export class LegacySQLiteProductAdapter implements IProductRepository {
  async findById(id: string, businessId: string): Promise<ProductEntity | null> {
    // Legacy SQLite may not store business_id; keep parameter for interface compatibility.
    let row: any;
    try {
      const selectSql = `
      SELECT
        id,
        business_id,
        branch_id,
        category_id,
        name,
        description,
        sku,
        barcode,
        selling_price as price,
        cost_price,
        stock_quantity,
        minimum_stock as low_stock_threshold,
        image_url,
        is_available,
        is_featured,
        sort_order,
        metadata,
        version,
        sync_status,
        created_at,
        updated_at,
        deleted_at
      FROM products
      WHERE id = ?
        AND (deleted_at IS NULL OR deleted_at = '')
      LIMIT 1
    `;
      row = db.prepare(selectSql).get(id) as any | undefined;
    } catch (err: any) {
      forensicLog('findById', err, 'SELECT ... FROM products WHERE id = ?', [id]);
      throw err;
    }

    if (!row) return null;

    return this.map(row);
  }

  async findAll(
    businessId: string,
    query?: {
      page?: number;
      limit?: number;
      search?: string;
      category_id?: string;
      is_available?: boolean;
      is_featured?: boolean;
      sort_by?: 'name' | 'price' | 'stock_quantity' | 'created_at' | 'sort_order';
      sort_order?: 'asc' | 'desc';
    }
  ): Promise<{
    data: ProductEntity[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 50;
    const offset = (page - 1) * limit;

    const where: string[] = [`(deleted_at IS NULL OR deleted_at = '')`];

    // If legacy DB doesn't have business_id, this won't filter (but keeps future-proofing).
    where.push(`(business_id = ? OR business_id IS NULL OR business_id = '')`);

    const params: any[] = [businessId];

    if (typeof query?.is_available === 'boolean') {
      where.push(`is_available = ?`);
      params.push(query.is_available ? 1 : 0);
    }
    if (typeof query?.is_featured === 'boolean') {
      where.push(`is_featured = ?`);
      params.push(query.is_featured ? 1 : 0);
    }
    if (query?.category_id) {
      where.push(`category_id = ?`);
      params.push(query.category_id);
    }
    if (query?.search) {
      where.push(`name LIKE ?`);
      params.push(`%${query.search}%`);
    }

    const sortBy = query?.sort_by ?? 'sort_order';
    const sortOrder = query?.sort_order ?? 'asc';
    const sortColumn =
      sortBy === 'name'
        ? 'name'
        : sortBy === 'price'
          ? 'selling_price'
          : sortBy === 'stock_quantity'
            ? 'stock_quantity'
            : sortBy === 'created_at'
              ? 'created_at'
              : 'sort_order';

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    let countRow: any;
    let rows: any[] = [];
    try {
      countRow = db
        .prepare(`SELECT COUNT(1) as total FROM products ${whereSql}`)
        .get(...params) as any;

      rows = db
        .prepare(
          `
        SELECT
          id,
          business_id,
          branch_id,
          category_id,
          name,
          description,
          sku,
          barcode,
          selling_price as price,
          cost_price,
          stock_quantity,
          minimum_stock as low_stock_threshold,
          image_url,
          is_available,
          is_featured,
          sort_order,
          metadata,
          version,
          sync_status,
          created_at,
          updated_at,
          deleted_at
        FROM products
        ${whereSql}
        ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
        LIMIT ?
        OFFSET ?
      `
        )
        .all(...params, limit, offset) as any[];
    } catch (err: any) {
      forensicLog('findAll / listProducts', err, `SELECT ... FROM products ${whereSql}`, params);
      throw err;
    }

    const total = Number(countRow?.total ?? 0);

    return {
      data: (rows || []).map(r => this.map(r)),
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    };
  }

  async create(dto: any, businessId: string, userId?: string): Promise<ProductEntity> {
    const now = new Date().toISOString();

    const stmt = db.prepare(
      `
      INSERT INTO products (
        business_id,
        branch_id,
        category_id,
        name,
        description,
        sku,
        barcode,
        selling_price,
        cost_price,
        stock_quantity,
        minimum_stock,
        image_url,
        is_available,
        is_featured,
        sort_order,
        metadata,
        version,
        sync_status,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        0,
        'pending',
        ?,
        ?,
        NULL
      )
    `
    );

    stmt.run(
      businessId,
      dto.branch_id ?? null,
      dto.category_id ?? null,
      dto.name,
      dto.description ?? null,
      dto.sku ?? null,
      dto.barcode ?? null,
      dto.price,
      dto.cost_price ?? null,
      dto.stock_quantity ?? 0,
      dto.low_stock_threshold ?? 0,
      dto.image_url ?? null,
      dto.is_available ?? 1,
      dto.is_featured ?? 0,
      dto.sort_order ?? 0,
      dto.metadata ?? null,
      now,
      now
    );

    // Best-effort: return newest row by unique name+created_at is risky; use lastInsertRowid.
    const row = db.prepare(`SELECT * FROM products WHERE rowid = last_insert_rowid()`).get() as any;
    if (!row) throw new Error('Failed to create product (legacy sqlite)');

    return this.map(row);
  }

  async update(id: string, dto: any, businessId: string): Promise<ProductEntity> {
    const now = new Date().toISOString();

    const patch: any = {
      category_id: dto.category_id ?? undefined,
      name: dto.name ?? undefined,
      description: dto.description ?? undefined,
      sku: dto.sku ?? undefined,
      barcode: dto.barcode ?? undefined,
      selling_price: dto.price ?? undefined,
      cost_price: dto.cost_price ?? undefined,
      stock_quantity: dto.stock_quantity ?? undefined,
      minimum_stock: dto.low_stock_threshold ?? undefined,
      image_url: dto.image_url ?? undefined,
      is_available: dto.is_available ?? undefined,
      is_featured: dto.is_featured ?? undefined,
      sort_order: dto.sort_order ?? undefined,
      metadata: dto.metadata ?? undefined,
      updated_at: now,
      sync_status: 'pending',
    };

    const keys = Object.keys(patch).filter(k => patch[k] !== undefined);
    if (keys.length === 0) {
      // fetch current
      const row = db.prepare(`SELECT * FROM products WHERE id = ? AND business_id = ?`).get(id, businessId) as any;
      if (!row) throw new Error('Product not found (legacy sqlite)');
      return this.map(row);
    }

    const setSql = keys.map(k => `${k} = ?`).join(', ');
    const params = keys.map(k => patch[k]).concat([id, businessId]);

    db.prepare(`UPDATE products SET ${setSql} WHERE id = ? AND business_id = ?`).run(...params);

    const row = db.prepare(`SELECT * FROM products WHERE id = ? AND business_id = ?`).get(id, businessId) as any;
    if (!row) throw new Error('Product not found after update (legacy sqlite)');

    return this.map(row);
  }

  async softDelete(id: string, businessId: string): Promise<void> {
    const now = new Date().toISOString();
    db.prepare(`UPDATE products SET deleted_at = ? WHERE id = ? AND business_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).run(
      now,
      id,
      businessId
    );
  }

  private map(row: any): ProductEntity {
    return {
      id: String(row.id),
      business_id: row.business_id ?? businessIdFallback(),
      branch_id: row.branch_id ?? null,
      category_id: row.category_id ?? null,
      name: row.name,
      description: row.description ?? null,
      sku: row.sku ?? null,
      barcode: row.barcode ?? null,
      price: String(row.price ?? row.price === 0 ? row.price : row.selling_price ?? row.price),
      cost_price: row.cost_price ?? null,
      stock_quantity: Number(row.stock_quantity ?? 0),
      low_stock_threshold: Number(row.low_stock_threshold ?? row.minimum_stock ?? 0),
      image_url: row.image_url ?? null,
      is_available: !!row.is_available,
      is_featured: !!row.is_featured,
      sort_order: Number(row.sort_order ?? 0),
      metadata: row.metadata ?? null,
      version: Number(row.version ?? 0),
      sync_status: row.sync_status ?? 'pending',
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at ?? null,
    };
  }
}

function businessIdFallback(): string {
  return 'default-business';
}
