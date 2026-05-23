// src/server/tables/repositories/legacy/legacy-sqlite-table.adapter.ts
// Legacy adapter so the old SQLite code keeps working when flag is false

import { db } from '../../../db/database';
import { TableEntity, TableListQuery } from '../../types/table.types';
import { ITableRepository, PaginatedTables } from '../table.repository.interface';

export class LegacySQLiteTableAdapter implements ITableRepository {
  async findByQrToken(qrToken: string, businessId: string): Promise<TableEntity | null> {
    const row = db.prepare(`
      SELECT id, table_number, capacity, status, assigned_waiter_id, qr_token, created_at, updated_at
      FROM restaurant_tables
      WHERE qr_token = ?
      LIMIT 1
    `).get(qrToken) as any;

    if (!row) return null;

    return this.mapRow(row, businessId);
  }

  async findAll(businessId: string, query: TableListQuery = {}): Promise<PaginatedTables> {
    const limit = query.limit ?? 50;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT id, table_number, capacity, status, assigned_waiter_id, qr_token, created_at, updated_at
      FROM restaurant_tables
    `;
    const params: any[] = [];

    if (query.status) {
      sql += ` WHERE status = ?`;
      params.push(query.status);
    }

    sql += ` ORDER BY table_number ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as any[];

    const items = rows.map(r => this.mapRow(r, businessId));

    return {
      items,
      total: items.length, // simple for legacy
      page,
      limit,
      totalPages: 1,
    };
  }

  async findById(id: string | number, businessId: string): Promise<TableEntity | null> {
    const row = db.prepare(`
      SELECT id, table_number, capacity, status, assigned_waiter_id, qr_token, created_at, updated_at
      FROM restaurant_tables
      WHERE id = ?
      LIMIT 1
    `).get(id) as any;

    return row ? this.mapRow(row, businessId) : null;
  }

  private mapRow(row: any, businessId: string): TableEntity {
    return {
      id: row.id,
      business_id: businessId,
      table_number: row.table_number,
      capacity: row.capacity,
      status: row.status,
      assigned_waiter_id: row.assigned_waiter_id,
      qr_token: row.qr_token,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
