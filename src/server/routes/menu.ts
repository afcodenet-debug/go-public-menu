// src/server/routes/menu.ts
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { getProductRepository } from '../products/repositories/product.repository.provider';
import { getTableRepository } from '../tables/repositories/table.repository.provider';
import { env } from '../config/env';
import db from '../db/database';

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

// ─────────────────────────────────────────────────────────────────────────────
// Customer registration for QR Menu (public, no auth required)
// POST /api/menu/register-customer
// Body: { phone_number: string (digits) }
// Response: { success: boolean, phone_number: string, pin_code: string, alreadyExists?: boolean }
// Requirements implemented:
// - phone_number UNIQUE
// - email UNIQUE (optional)
// - name = "Client" + random 6 digits
// - pin_code = last 6 digits of phone_number
// - Professional error handling + logging
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register-customer', async (req, res) => {
  const { phone_number } = req.body || {};

  console.log('[Public Menu] register-customer request', { phone_number: phone_number ? phone_number.slice(0, 3) + '***' : null });

  if (!phone_number || typeof phone_number !== 'string') {
    return res.status(400).json({ error: 'Numéro de téléphone requis' });
  }

  const digits = phone_number.replace(/\D/g, '');

  if (digits.length < 9) {
    return res.status(400).json({ error: 'Numéro minimum 9 chiffres' });
  }
  if (digits.length > 14) {
    return res.status(400).json({ error: 'Numéro maximum 14 chiffres' });
  }

  const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    // 1. Check if phone already exists
    const { data: existing, error: checkErr } = await supabase
      .from('customers')
      .select('phone_number, pin_code, name')
      .eq('phone_number', digits)
      .single();

    if (checkErr && checkErr.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[Public Menu] Error checking existing customer:', checkErr);
      return res.status(500).json({ error: 'Erreur lors de la vérification du numéro' });
    }

    if (existing) {
      // Already registered → return existing PIN (last 6 digits)
      console.log('[Public Menu] Customer already exists', { phone: digits.slice(0, 3) + '***' });
      return res.json({
        success: true,
        phone_number: existing.phone_number,
        pin_code: existing.pin_code,
        alreadyExists: true,
      });
    }

    // 2. Generate data
    const randomSuffix = Math.floor(100000 + Math.random() * 900000); // 6 digits
    const name = `Client${randomSuffix}`;
    const pin_code = digits.slice(-6); // last 6 digits (pad left with 0 if needed? but phones are long enough)
    const email = null; // optional, not provided in this flow

    // 3. Insert new customer
    const { data: inserted, error: insertErr } = await supabase
      .from('customers')
      .insert({
        phone_number: digits,
        name,
        pin_code,
        email,                    // can be updated later
        created_at: new Date().toISOString(),
      })
      .select('phone_number, pin_code')
      .single();

    if (insertErr) {
      // Handle unique constraint violations gracefully
      if (insertErr.code === '23505') { // unique_violation
        console.warn('[Public Menu] Duplicate during insert (race condition)', insertErr.details);
        return res.status(409).json({
          error: 'Ce numéro est déjà enregistré',
          alreadyExists: true,
        });
      }
      console.error('[Public Menu] Failed to insert customer:', insertErr);
      return res.status(500).json({ error: 'Erreur d’enregistrement' });
    }

    console.log('[Public Menu] New customer registered successfully', {
      phone: digits.slice(0, 3) + '***',
      name,
      pin_code: '******',
    });

    return res.json({
      success: true,
      phone_number: inserted.phone_number,
      pin_code: inserted.pin_code,
      alreadyExists: false,
    });
  } catch (err: any) {
    console.error('[Public Menu] Unexpected error in register-customer:', err);
    return res.status(500).json({ error: 'Erreur d’enregistrement' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer order checkout for QR Menu
// POST /api/menu/checkout
// Body: { qr_token, customer_phone?, pin_code, items: [{product_id, quantity, name?}], notes?, order_id?, total? }
// Validates PIN (phone optional → lookup by pin_code alone) and creates pending order in Supabase.
// Notes (special instructions) are accepted and embedded as cartItems.notes inside the items JSONB.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  const { qr_token, customer_phone, pin_code, items, notes, order_id } = req.body || {};

  if (!qr_token || !pin_code || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Données de commande incomplètes' });
  }

  const cleanPin = String(pin_code).trim();

  if (cleanPin.length !== 6) {
    return res.status(400).json({ error: 'Le code PIN doit contenir 6 chiffres' });
  }

  const supabase = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    // 1. Lookup customer by PIN (phone number is optional in the request)
    // If phone is provided → use it for faster/more precise lookup
    // If phone is not provided → lookup by PIN only (as per your requirement)
    let customer = null;
    let finalCustomerPhone = null;

    if (customer_phone) {
      finalCustomerPhone = String(customer_phone).replace(/\D/g, '');
      const { data: rows, error: custErr } = await supabase
        .from('customers')
        .select('id, phone_number, pin_code, name')
        .eq('phone_number', finalCustomerPhone)
        .eq('pin_code', cleanPin)
        .limit(1);

      const data = rows?.[0] ?? null;
      if (!custErr && data) customer = data;
    } else {
      // No phone provided → search by PIN only
      const { data: rows, error: custErr } = await supabase
        .from('customers')
        .select('id, phone_number, pin_code, name')
        .eq('pin_code', cleanPin)
        .limit(1);

      const data = rows?.[0] ?? null;
      if (!custErr && data) {
        customer = data;
        finalCustomerPhone = data.phone_number;  // found from DB
      }
    }

    if (!customer) {
      console.warn('[Public Menu] Invalid PIN attempt (no matching customer found)');
      return res.status(401).json({ 
        error: 'Code PIN incorrect', 
        pinNotFound: true 
      });
    }

    // Use the phone found in DB if it wasn't sent by the client
    if (!finalCustomerPhone) finalCustomerPhone = customer.phone_number;

    // 2. Find the table from qr_token (including assigned waiter for the order)
    const { data: table, error: tableErr } = await supabase
      .from('restaurant_tables')
      .select('id, table_number, assigned_waiter_id, status')
      .eq('qr_token', qr_token)
      .single();

    if (tableErr || !table) {
      return res.status(404).json({ error: 'Table introuvable pour ce code QR' });
    }

    // 3. Create order in Supabase (minimal but respecting the schema)
    // waiter_id is REQUIRED (NOT NULL + FK to users)
    let waiterId = table.assigned_waiter_id;

    // Verify the waiter exists (to avoid FK violation)
    if (waiterId) {
      const { data: exists } = await supabase
        .from('users')
        .select('id')
        .eq('id', waiterId)
        .single();

      if (!exists) {
        waiterId = null; // invalid, try fallback
      }
    }

    if (!waiterId) {
      // Fallback: find any admin or manager
      const { data: fallbackUser } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'manager'])
        .limit(1)
        .single();

      waiterId = fallbackUser?.id;
    }

    if (!waiterId) {
      console.error('[Public Menu] No valid waiter_id found for customer order');
      return res.status(500).json({ error: 'Aucun serveur disponible pour traiter cette commande pour le moment' });
    }

    // Preserve special instructions inside the items JSONB (as .notes on the array)
    // so they survive without a 'notes' column on the orders table.
    const cartItems: any = [...items];
    if (notes && String(notes).trim()) {
      cartItems.notes = String(notes).trim();
    }

    const orderPayload: any = {
      table_id: table.id,
      waiter_id: waiterId,
      customer_id: customer.id,
      status: 'pending',
      items: cartItems,                // array (with optional .notes) stored as JSONB
      total: Number(req.body.total || 0),
      // Let the database/trigger handle created_at and updated_at
    };

    // Never trust client-provided PK for public QR orders
    delete orderPayload.id;
    delete orderPayload.order_id;

    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert(orderPayload)
      .select('id')
      .single();

    if (orderError) {
      console.error('[Public Menu][CHECKOUT ERROR] Full Supabase error when inserting into orders:');
      console.error(orderError);
      console.error('Payload we tried to insert:', JSON.stringify(orderPayload, null, 2));

      // Special handling for the common sequence desync issue
      if (orderError.code === '23505' || (orderError.message || '').includes('duplicate key') || (orderError.message || '').includes('orders_pkey')) {
        return res.status(500).json({
          error: 'Erreur de numérotation des commandes (séquence désynchronisée)',
          debug: 'Exécutez dans Supabase SQL: SELECT setval(pg_get_serial_sequence(\'orders\', \'id\'), COALESCE((SELECT MAX(id) FROM orders), 0) + 1, false);'
        });
      }

      return res.status(500).json({ 
        error: 'Impossible de créer la commande pour le moment',
        debug: orderError.message || orderError.details || JSON.stringify(orderError)
      });
    }

    const newOrderId = newOrder.id;

    // 4. Insert order items (best effort)
    const orderItemsPayload = items.map((item: any) => ({
      order_id: newOrderId,
      product_id: item.product_id,
      quantity: Number(item.quantity) || 1,
      created_at: new Date().toISOString(),
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload);

    if (itemsError) {
      console.warn('[Public Menu] Order items insertion had issues (order still created):', itemsError);
    }

    console.log('[Public Menu] Order created successfully via QR (pending admin review)', {
      orderId: newOrderId,
      table: table.table_number,
      customer: finalCustomerPhone ? finalCustomerPhone.slice(0, 3) + '***' : 'unknown',
      itemsCount: items.length,
    });

    // Best decision: automatically repair the orders.id sequence after every public QR order.
    // This prevents the "duplicate key on orders_pkey" error from recurring due to sync/manual inserts.
    try {
      await supabase.rpc('advance_orders_sequence');
    } catch (seqErr) {
      console.warn('[Public Menu] Sequence auto-advance failed (non-fatal, run the SQL setup once):', seqErr);
    }

    return res.json({
      success: true,
      orderId: newOrderId,
      customerPhone: finalCustomerPhone,
    });

  } catch (err: any) {
    console.error('[Public Menu] Checkout error:', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la commande' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public order status for QR customers (reads directly from Supabase)
// This allows customers to see real-time status updates (confirmed, preparing, ready...)
// even if the local POS pull worker hasn't synced yet.
// GET /api/menu/order-status/:orderId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/order-status/:orderId', async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from('orders')
      .select('id, status, table_id, total, items, created_at, updated_at')
      .eq('id', Number(orderId))
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Enrich items with current local prices (important for "My order" list in public QR menu)
    let items = data.items || [];
    if (db && Array.isArray(items)) {
      try {
        const getPriceStmt = db.prepare('SELECT selling_price FROM products WHERE id = ?').pluck();
        items = items.map((it: any) => {
          const pid = it.product_id || it.productId;
          if (pid != null) {
            const existingPrice = Number(it.price ?? it.unit_price ?? 0);
            if (existingPrice <= 0) {
              const price = Number(getPriceStmt.get(pid) || 0);
              return { ...it, price };
            }
          }
          return it;
        });
      } catch (e) {
        console.warn('[Public Menu] Price enrichment failed for order-status', e);
      }
    }

    res.json({
      id: data.id,
      status: data.status,
      table_id: data.table_id,
      total: data.total,
      items,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });
  } catch (err: any) {
    console.error('[Public Menu] Order status error:', err);
    res.status(500).json({ error: 'Failed to fetch order status' });
  }
});

export default router;
