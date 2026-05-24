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
      console.log('[Public Menu] Serving products from Supabase (direct query on real schema)');

      const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      });

      const { data: supaProducts, error } = await supabase
        .from('products')
        .select('id, category_id, name, description, selling_price, buying_price, stock_quantity, minimum_stock, unit, image_url, is_available')
        .eq('is_available', true)
        .order('category_id')
        .limit(1000);

      if (error) {
        console.error('[Public Menu] Direct Supabase products query failed:', error);
        products = [];
      } else {
        products = (supaProducts || []).map((p: any) => ({
          id: p.id,
          category_id: p.category_id,
          name: p.name,
          description: p.description,
          price: Number(p.selling_price) || 0,           // ← on lit directement selling_price
          currency: 'ZMW',
          unit: p.unit ?? 'pcs',
          image_url: p.image_url,
          is_available: p.is_available ? 1 : 0,
          stock_quantity: Number(p.stock_quantity ?? 0),
          minimum_stock: Number(p.minimum_stock ?? 0),
        }));

        console.log('[Public Menu][PRICE DEBUG] Direct Supabase query used. Sample prices:', 
          products.slice(0, 5).map((x: any) => x.price));
      }
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
            price: p.price,           // already normalized above from selling_price
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
