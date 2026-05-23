import express from 'express';
import { db } from '../db/database';
import { OrderService } from '../services/order.service';
import { getProductRepository } from '../products/repositories/product.repository.provider';
import { getTableRepository } from '../tables/repositories/table.repository.provider';
import { env } from '../config/env';

const router = express.Router();

type MenuCategoryRow = {
  id: number;
  name: string;
  description: string | null;
  display_order: number;
};

type TableRow = {
  id: number;
  table_number: string;
  capacity: number;
  status: string;
  assigned_waiter_id: number | null;
  qr_token: string | null;
};

type MenuItemRow = {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  unit: string | null;
  image_url: string | null;
  is_available: number;
  display_order: number;
};

/**
 * Public: list active menu categories
 */
router.get('/categories', (_req, res) => {
  try {
    const categories = db.prepare(`
      SELECT id, name, description, display_order
      FROM menu_categories
      WHERE is_active = 1
      ORDER BY display_order ASC, id ASC
    `).all() as MenuCategoryRow[];

    res.json({ categories });
  } catch (error: any) {
    console.error('[Menu] GET /categories error:', error);
    res.status(500).json({ error: error?.message || 'Failed to fetch categories' });
  }
});

/**
 * Public: menu for a table identified by qr_token
 */
router.get('/table/:qr_token', async (req, res) => {
  const { qr_token } = req.params;

  try {
    let table: any;

    if (env.USE_SUPABASE_TABLES) {
      const tableRepo = getTableRepository();
      table = await tableRepo.findByQrToken(qr_token, 'default-business');
    } else {
      table = db.prepare(`
        SELECT id, table_number, capacity, status, assigned_waiter_id, qr_token
        FROM restaurant_tables
        WHERE qr_token = ?
        LIMIT 1
      `).get(qr_token) as TableRow | undefined;
    }

    if (!table) {
      return res.status(404).json({ error: 'Table not found for given qr_token' });
    }

    // === PUBLIC MENU: use Supabase when flag is on, legacy SQLite otherwise ===
    // This is the key change so that Render can serve the QR menu from Supabase
    // instead of the local SQLite file on the Render disk.
    let products: Array<any>;

    if (env.USE_SUPABASE_PRODUCTS) {
      console.log('[Public Menu] Serving from Supabase (USE_SUPABASE_PRODUCTS=true) for token', qr_token);
      const repo = getProductRepository();

      // Preferred method for public QR menu (returns flat array, already filtered)
      const items = await repo.findAvailableForMenu('default-business');

      // Map ProductEntity → legacy shape expected by grouping logic + PublicMenuPage
      products = items.map((p: any) => ({
        id: p.id,
        category_id: p.category_id,
        name: p.name,
        description: p.description,
        price: p.price,
        currency: 'ZMW',
        unit: p.unit ?? null,
        image_url: p.image_url,
        is_available: p.is_available ? 1 : 0,
        stock_quantity: p.stock_quantity ?? 0,
        minimum_stock: p.low_stock_threshold ?? 0,
      }));
    } else {
      console.log('[Public Menu] Serving real products from local SQLite `products` table for token', qr_token);

      products = db.prepare(`
        SELECT 
          p.id,
          p.category_id,
          p.name,
          p.description,
          p.selling_price as price,
          'ZMW' as currency,
          p.unit,
          p.image_url,
          p.is_available,
          p.stock_quantity,
          p.minimum_stock
        FROM products p
        WHERE p.is_available = 1
        ORDER BY p.category_id ASC, p.name ASC
      `).all() as Array<any>;
    }

    const categoryIds = Array.from(
      new Set(products.map(p => p.category_id).filter((x): x is number => typeof x === 'number'))
    );

    const categories = categoryIds.length
      ? (db.prepare(`
          SELECT id, name, description
          FROM categories
          WHERE id IN (${categoryIds.map(() => '?').join(',')})
          ORDER BY name ASC
        `).all(...categoryIds) as Array<{ id: number; name: string; description: string | null }>)
      : [];

    const categoriesById = new Map<number, { id: number; name: string; description: string | null }>();
    for (const c of categories) categoriesById.set(c.id, c);

    const productsByCategory = new Map<number, any[]>();
    for (const p of products as any[]) {
      const arr = productsByCategory.get(p.category_id) ?? [];
      arr.push(p);
      productsByCategory.set(p.category_id, arr);
    }

    const menu = Array.from(productsByCategory.entries())
      .map(([categoryId, items]) => {
        const c = categoriesById.get(categoryId);
        // If category row is missing, still return it as a fallback
        const categoryName = c?.name ?? `Category ${categoryId}`;
        const categoryDescription = c?.description ?? null;

        return {
          id: categoryId,
          name: categoryName,
          description: categoryDescription,
          items: (items ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            currency: p.currency,
            unit: p.unit,
            image_url: p.image_url,
            is_available: p.is_available,
            stock_quantity: p.stock_quantity,
            in_stock: Number(p.stock_quantity) > 0
          }))
        };
      })
      // keep only categories with products
      .filter(c => c.items.length > 0);

    res.json({
      table: {
        id: table.id,
        table_number: table.table_number,
        capacity: table.capacity,
        status: table.status,
        assigned_waiter_id: table.assigned_waiter_id,
        qr_token: table.qr_token,
      },
      menu,
    });
  } catch (error: any) {
    console.error('[Menu] GET /table/:qr_token error:', error);
    res.status(500).json({ error: error?.message || 'Failed to fetch menu' });
  }
});

/**
 * Public: customer reports a product as out of stock from the QR menu
 * This can be wired to the notification system for the assigned waiter + managers.
 */
router.post('/stock-alert', async (req, res) => {
  const { qr_token, product_id, product_name, table_number, message } = req.body;

  try {
    if (!product_id) {
      return res.status(400).json({ error: 'product_id is required' });
    }

    let tableRow: any | undefined;
    if (qr_token) {
      tableRow = db.prepare(`
        SELECT id, table_number, assigned_waiter_id, qr_token
        FROM restaurant_tables
        WHERE qr_token = ?
        LIMIT 1
      `).get(qr_token);
    }

    if (!tableRow && table_number) {
      tableRow = db.prepare(`
        SELECT id, table_number, assigned_waiter_id, qr_token
        FROM restaurant_tables
        WHERE table_number = ?
        LIMIT 1
      `).get(table_number);
    }

    if (!tableRow) {
      return res.status(404).json({ error: 'Table not found for given qr_token/table_number' });
    }
    if (!tableRow.assigned_waiter_id) {
      return res.status(400).json({ error: 'No assigned waiter for this table' });
    }

    const product: any = db.prepare(`
      SELECT id, name, selling_price as price, unit
      FROM products
      WHERE id = ?
      LIMIT 1
    `).get(Number(product_id));

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const order = await OrderService.create({
      table_id: Number(tableRow.id),
      waiter_id: Number(tableRow.assigned_waiter_id),
      status: 'pending',
      items: [
        {
          productId: Number(product.id),
          name: product.name || product_name || 'Item',
          price: Number(product.price) || 0,
          quantity: 1,
          notes: message ? String(message) : null,
        },
      ],
      total: (Number(product.price) || 0) * 1,
    } as any);

    return res.json({ success: true, orderId: (order as any).id });
  } catch (err: any) {
    console.error('[PUBLIC MENU ALERT] error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to handle stock alert' });
  }
});

router.post('/checkout', async (req, res) => {
  const { qr_token, items, notes, order_id } = req.body;

  try {
    if (!qr_token) {
      return res.status(400).json({ error: 'qr_token is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    const tableRow: any = db.prepare(`
      SELECT id, table_number, assigned_waiter_id, qr_token
      FROM restaurant_tables
      WHERE qr_token = ?
      LIMIT 1
    `).get(qr_token);

    if (!tableRow) {
      return res.status(404).json({ error: 'Table not found for given qr_token' });
    }
    if (!tableRow.assigned_waiter_id) {
      return res.status(400).json({ error: 'No assigned waiter for this table' });
    }

    const normalized = items
      .map((it: any) => ({
        product_id: Number(it.product_id ?? it.productId ?? it.id),
        quantity: Number(it.quantity ?? it.qty ?? 1),
      }))
      .filter((it: any) => Number.isFinite(it.product_id) && it.product_id > 0 && it.quantity > 0);

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'No valid items provided' });
    }

    const ids = normalized.map((x: any) => x.product_id);
    const products: any[] = db.prepare(`
      SELECT id, name, selling_price as price, unit
      FROM products
      WHERE id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);

    const productById = new Map<number, any>();
    for (const p of products) productById.set(Number(p.id), p);

    const orderItems = normalized.map((n: any) => {
      const p = productById.get(n.product_id);
      if (!p) throw new Error(`Product not found: ${n.product_id}`);
      return {
        productId: Number(p.id),
        name: p.name || 'Item',
        price: Number(p.price) || 0,
        quantity: n.quantity,
        notes: notes ? String(notes) : null,
      };
    });

    const total = orderItems.reduce((sum: number, it: any) => sum + it.price * it.quantity, 0);

    // PIN-first authentication for public QR menu customers.
    // If a pin_code is provided, look it up directly in the customers table.
    // If found, use that customer (proceed with auth flow). Only after 3 failed attempts for unknown PINs is account creation offered (handled in frontend).
    // This prevents creating orders for non-existing PINs and avoids forcing account creation on valid PINs.
    let customerId: number | null = null;
    let resolvedCustomerPhone: string | null = null;
    const phoneIn = req.body.customer_phone ? String(req.body.customer_phone).replace(/\D/g, '') : null;
    const pinIn = req.body.pin_code ? String(req.body.pin_code).trim() : null;

    if (pinIn) {
      // Primary flow: authenticate by PIN alone (user enters only their 4-digit PIN from the table)
      const customer = db.prepare(`
        SELECT id, phone_number, pin_code, name 
        FROM customers 
        WHERE pin_code = ? 
        ORDER BY id DESC 
        LIMIT 1
      `).get(pinIn) as any;

      if (!customer) {
        return res.status(404).json({ 
          error: 'Code PIN introuvable. Veuillez réessayer ou créer un compte après 3 tentatives infructueuses.',
          pinNotFound: true,
          requiresRegistration: true 
        });
      }

      // If phone also provided (e.g. from persisted state), we still trust the PIN match for this flow.
      // (If strict match wanted: if (phoneIn && phoneIn !== customer.phone_number) { return 401 ... })
      customerId = customer.id;
      resolvedCustomerPhone = customer.phone_number;
    } else if (phoneIn) {
      // Legacy / fallback path: phone provided without pin (should not happen in new UI, but keep for compatibility)
      if (!pinIn) {
        return res.status(400).json({ error: 'Code PIN requis pour soumettre une commande.' });
      }
      const customer = db.prepare(`
        SELECT id, pin_code, phone_number, name 
        FROM customers 
        WHERE phone_number = ?
      `).get(phoneIn) as any;

      if (!customer) {
        return res.status(404).json({ 
          error: 'Client introuvable. Créez un compte d\'abord.',
          requiresRegistration: true 
        });
      }

      if (String(customer.pin_code) !== pinIn) {
        return res.status(401).json({ 
          error: 'Code PIN invalide pour ce numéro de téléphone.',
          requiresRegistration: false 
        });
      }

      customerId = customer.id;
      resolvedCustomerPhone = customer.phone_number;
    }
    // if neither, customerId remains null (anonymous order - allowed for now)

    const order = await OrderService.create({
      table_id: Number(tableRow.id),
      waiter_id: Number(tableRow.assigned_waiter_id),
      status: 'pending',
      items: orderItems,
      total,
      customer_id: customerId,
    } as any);

    return res.json({ 
      success: true, 
      orderId: (order as any).id, 
      customerId,
      customerPhone: resolvedCustomerPhone 
    });
  } catch (err: any) {
    console.error('[PUBLIC MENU CHECKOUT] error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to handle checkout' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer self-service from QR Menu (public, no staff auth required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/menu/register-customer
 * Lightweight customer account creation from the public QR menu.
 * - phone_number is normalized (digits only)
 * - pin_code defaults to last 4 digits of phone if not provided
 */
router.post('/register-customer', async (req, res) => {
  try {
    const { phone_number, name, pin_code } = req.body || {};

    if (!phone_number) {
      return res.status(400).json({ error: 'phone_number is required' });
    }

    const normalized = String(phone_number).replace(/\D/g, '');
    if (normalized.length < 4) {
      return res.status(400).json({ error: 'Phone number must contain at least 4 digits' });
    }

    const pin = pin_code ? String(pin_code).trim() : normalized.slice(-4);

    // Check if already exists
    const existing = db.prepare(`
      SELECT id, name, phone_number, pin_code 
      FROM customers 
      WHERE phone_number = ?
    `).get(normalized) as any;

    if (existing) {
      return res.json({
        success: true,
        customerId: existing.id,
        phone_number: existing.phone_number,
        pin_code: existing.pin_code,
        name: existing.name,
        alreadyExists: true
      });
    }

    // Create new
    const result = db.prepare(`
      INSERT INTO customers (name, phone_number, pin_code, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      name || `Client ${normalized.slice(-4)}`,
      normalized,
      pin
    );

    return res.json({
      success: true,
      customerId: result.lastInsertRowid,
      phone_number: normalized,
      pin_code: pin,
      name: name || `Client ${normalized.slice(-4)}`,
      alreadyExists: false
    });
  } catch (err: any) {
    console.error('[MENU] register-customer error:', err);
    return res.status(500).json({ error: 'Failed to register customer' });
  }
});

/**
 * POST /api/menu/validate-order
 * Customer validates / claims their order by providing phone + correct PIN.
 * This is the "order validation" step required by the workflow.
 */
router.post('/validate-order', async (req, res) => {
  try {
    const { phone_number, pin_code, order_id } = req.body || {};

    if (!phone_number || !pin_code || !order_id) {
      return res.status(400).json({ 
        error: 'phone_number, pin_code and order_id are required' 
      });
    }

    const normalized = String(phone_number).replace(/\D/g, '');
    const pin = String(pin_code).trim();

    const customer = db.prepare(`
      SELECT id, name, phone_number, pin_code 
      FROM customers 
      WHERE phone_number = ?
    `).get(normalized) as any;

    if (!customer) {
      return res.status(404).json({ 
        error: 'Customer not found. Please create an account first.',
        requiresRegistration: true 
      });
    }

    if (String(customer.pin_code) !== pin) {
      return res.status(401).json({ 
        error: 'Invalid PIN code',
        requiresRegistration: false 
      });
    }

    // Persist the validation: link the customer to the order (keep pending for staff to accept/reject)
    try {
      db.prepare(`
        UPDATE orders 
        SET customer_id = ?, 
            status = 'pending',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(customer.id, Number(order_id));
    } catch (updateErr) {
      console.warn('[validate-order] Failed to attach customer_id to order:', updateErr);
    }

    return res.json({
      success: true,
      customerId: customer.id,
      customerName: customer.name,
      phone_number: customer.phone_number,
      orderId: Number(order_id),
      message: 'Order successfully validated by customer'
    });
  } catch (err: any) {
    console.error('[MENU] validate-order error:', err);
    return res.status(500).json({ error: 'Validation failed' });
  }
});

export default router;
