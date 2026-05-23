import { db } from '../../../db/database';
import { ProductEntity, IProductRepository } from '../product.repository.interface';

export class LegacySQLiteProductAdapter implements IProductRepository {
  async findAvailableForMenu(): Promise<ProductEntity[]> {
    const rows = db.prepare(`
      SELECT id, name, description, selling_price as price, category_id,
             image_url, is_available, stock_quantity, unit, minimum_stock as low_stock_threshold
      FROM products
      WHERE is_available = 1
    `).all() as any[];

    return rows.map(r => ({ ...r, is_available: !!r.is_available }));
  }
}
