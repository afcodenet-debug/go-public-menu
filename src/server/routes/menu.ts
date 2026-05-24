// src/server/routes/menu.ts
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { getProductRepository } from '../products/repositories/product.repository.provider';
import { getTableRepository } from '../tables/repositories/table.repository.provider';
import { env } from '../config/env';

const router = express.Router();

type TableRow = {
  id: number | string;
  table_number: string;
  capacity: number;
  status: string;
  assigned_waiter_id: number | string | null;
  qr_token: string | null;
};

router.get('/table/:qr_token', async (req, res) => {
  const { qr_token } = req.params;

  console.log('[MENU ROUTE HIT]', qr_token);

  try {
    console.log('[Public Menu] /table lookup start', {
      qr_token,
      USE_SUPABASE_TABLES: env.USE_SUPABASE_TABLES,
      USE_SUPABASE_PRODUCTS: env.USE_SUPABASE_PRODUCTS,
    });

    // Lazy-load local SQLite only when at least one flag is false (Render Supabase-only deploys must never open the DB file)
    const useLegacy = !env.USE_SUPABASE_TABLES || !env.USE_SUPABASE_PRODUCTS;
    let localDb: any = null;
    if (useLegacy) {
      const dbMod = await import('../db/database');
      localDb = dbMod.db;
      console.log('[Public Menu] Local SQLite module loaded (legacy path)');
    }

    // === TABLE (Supabase si flag activé) ===
    let table: any;
    if (env.USE_SUPABASE_TABLES) {
      const tableRepo = getTableRepository();
      table = await tableRepo.findByQrToken(qr_token);
      console.log('[Public Menu][FORENSIC] After tableRepo.findByQrToken', {
        qr_token,
        tableFound: !!table,
        table: table,
      });
    } else {
      table = localDb.prepare(`
        SELECT id, table_number, capacity, status, assigned_waiter_id, qr_token
        FROM restaurant_tables
        WHERE qr_token = ?
        LIMIT 1
      `).get(qr_token) as TableRow | undefined;
      console.log('[Public Menu] Table lookup via local SQLite', {
        qr_token,
        tableFound: !!table,
        tableId: table?.id ?? null,
      });
    }

    if (!table) {
      return res.status(404).json({ error: 'Table not found for given qr_token' });
    }

    // === PRODUCTS (Supabase si flag activé) ===
    let products: any[] = [];

    if (env.USE_SUPABASE_PRODUCTS) {
      console.log('[Public Menu] Serving products from Supabase (single-tenant, no business_id)');

      const productRepo = getProductRepository();
      // Pass undefined for businessId → no business filter (single-tenant public menu)
      const result = await productRepo.findAll(undefined, {
        is_available: true,
        limit: 1000,
        page: 1,
      });

      // === DEBUG: Inspect raw Supabase product prices ===
      // This will appear in Render logs when the QR menu is loaded.
      // Look for lines starting with [Public Menu][PRICE DEBUG]
      if (result.data && result.data.length > 0) {
        console.log('[Public Menu][PRICE DEBUG] First 3 raw products from Supabase:');
        result.data.slice(0, 3).forEach((p: any, idx: number) => {
          console.log(`  [${idx}] id=${p.id} name="${p.name}" price=${JSON.stringify(p.price)} selling_price=${JSON.stringify((p as any).selling_price)} cost_price=${JSON.stringify(p.cost_price)}`);
        });
        const samplePrices = result.data.slice(0, 5).map((p: any) => Number(p.price) || Number((p as any).selling_price) || 0);
        console.log('[Public Menu][PRICE DEBUG] Sample numeric prices after coercion:', samplePrices);
      } else {
        console.warn('[Public Menu][PRICE DEBUG] No products returned from Supabase findAll()');
      }
      // === END DEBUG ===

      products = result.data.map((p: any) => ({
        id: p.id,
        category_id: p.category_id,
        name: p.name,
        description: p.description,
        // Defensive: try price (new schema), then selling_price (legacy data), fallback to 0
        price: Number(p.price ?? (p as any).selling_price) || 0,
        currency: 'ZMW',
        unit: (p as any).unit ?? null,
        image_url: p.image_url,
        is_available: p.is_available ? 1 : 0,
        stock_quantity: p.stock_quantity ?? 0,
      }));
    } else {
      console.log('[Public Menu] Serving products from local SQLite');
      products = localDb.prepare(`
        SELECT 
          p.id, p.category_id, p.name, p.description,
          p.selling_price as price, 'ZMW' as currency,
          p.unit, p.image_url, p.is_available,
          p.stock_quantity, p.minimum_stock
        FROM products p
        WHERE p.is_available = 1
        ORDER BY p.category_id ASC, p.name ASC
      `).all() as any[];

      // Coerce to number for consistent API contract (SQLite returns number, but ensure)
      products = products.map((p: any) => ({ ...p, price: Number(p.price) || 0 }));

      // === DEBUG: Legacy path (should only happen if USE_SUPABASE_PRODUCTS is false on Render) ===
      console.log('[Public Menu][PRICE DEBUG] Legacy/SQLite path used. Sample prices:', products.slice(0,3).map((p:any) => p.price));
    }

    // Construction du menu (même logique qu’avant)
    const categoryIds = Array.from(
      new Set(products.map(p => p.category_id).filter((x): x is string | number => x != null))
    );

    // === CATEGORIES (Supabase ou local selon flags) ===
    let categories: Array<{ id: number; name: string; description: string | null }> = [];

    if (env.USE_SUPABASE_PRODUCTS) {
      // Fetch categories directly from Supabase (no local DB)
      if (categoryIds.length > 0) {
        const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { persistSession: false },
        });
        const { data: catData, error: catErr } = await supabase
          .from('categories')
          .select('id, name, description')
          .in('id', categoryIds);
        if (catErr) {
          console.warn('[Public Menu] Supabase categories query error:', catErr.message);
        } else {
          categories = (catData || []) as any;
        }
      }
    } else if (localDb && categoryIds.length > 0) {
      categories = localDb.prepare(`
        SELECT id, name, description
        FROM categories
        WHERE id IN (${categoryIds.map(() => '?').join(',')})
      `).all(...categoryIds) as any;
    }

    const categoriesById = new Map(categories.map(c => [c.id, c]));

    const productsByCategory = new Map<number, any[]>();
    for (const p of products) {
      const arr = productsByCategory.get(p.category_id) ?? [];
      arr.push(p);
      productsByCategory.set(p.category_id, arr);
    }

    const menu = Array.from(productsByCategory.entries())
      .map(([categoryId, items]) => {
        const c = categoriesById.get(categoryId);
        return {
          id: categoryId,
          name: c?.name ?? `Category ${categoryId}`,
          description: c?.description ?? null,
          items: items.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            // Final guarantee + defensive fallback for any remaining legacy data
            price: Number(p.price ?? (p as any).selling_price) || 0,
            currency: p.currency,
            unit: p.unit,
            image_url: p.image_url,
            is_available: p.is_available,
            stock_quantity: p.stock_quantity,
            in_stock: Number(p.stock_quantity) > 0,
          })),
        };
      })
      .filter(c => c.items.length > 0);

    // === FINAL DEBUG SUMMARY (always logged on QR menu load) ===
    const allPrices = menu.flatMap((c: any) => c.items.map((i: any) => i.price));
    console.log('[Public Menu][PRICE DEBUG] FINAL RESPONSE SUMMARY:');
    console.log('  Total categories:', menu.length);
    console.log('  Total items:', allPrices.length);
    console.log('  Sample prices sent to frontend:', allPrices.slice(0, 8));
    console.log('  Any zero prices?', allPrices.some((p: number) => p === 0));
    // === END DEBUG ===

    res.json({
      table: {
        id: table.id,
        table_number: table.table_number,
        capacity: table.capacity,
        status: table.status,
      },
      menu,
    });
  } catch (error: any) {
    console.error('[Public Menu] Error:', error);
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

export default router;
