import express from 'express';
import db from '../db/database';
import { requireRole } from '../middleware/auth';
import { env } from '../config/env';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// ── GET /api/categories ──────────────────────────────────────────────
// Returns all categories plus product_count for each.
// Cloud/Supabase: queries Supabase directly (product_count approximated via separate count or 0 for perf).
router.get('/', async (req, res) => {
  const isSupabase = env.RENDER_CLOUD_MODE || env.USE_SUPABASE_PRODUCTS;
  if (isSupabase && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data: cats, error } = await supa.from('categories').select('id, name, description, created_at').order('name');
      if (error) throw error;
      // product_count: lightweight (can be enhanced with RPC later)
      const withCount = await Promise.all((cats || []).map(async (c: any) => {
        const { count } = await supa.from('products').select('*', { count: 'exact', head: true }).eq('category_id', c.id).eq('is_available', true);
        return { ...c, id: c.id, product_count: count || 0 };
      }));
      return res.json(withCount);
    } catch (e: any) {
      console.error('[Categories Supabase] ', e);
      return res.status(500).json({ error: 'Failed to fetch categories from Supabase' });
    }
  }
  // legacy
  if (!db) {
    console.warn('[Categories] SQLite disabled (db is null). Returning []');
    return res.json([]);
  }
  try {
    const categories = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.created_at,
        COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id, c.name, c.description, c.created_at
      ORDER BY c.name ASC
    `).all();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ── POST /api/categories ─────────────────────────────────────────────
// Create a new category.
// Body: { name: string, description?: string }
router.post('/', requireRole(['admin', 'manager']), (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const trimmedName = name.trim();

    // Check for duplicate name (case-insensitive)
    const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(trimmedName);
    if (existing) {
      return res.status(409).json({ error: `La catégorie "${trimmedName}" existe déjà` });
    }

    const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(trimmedName, description ?? null);
    const newCategory = db.prepare('SELECT id, name, description, created_at FROM categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newCategory);
  } catch (error: any) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });
    }
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// ── PATCH /api/categories/:id ─────────────────────────────────────────
// Rename / re-describe an existing category.
// Body: { name?: string, description?: string | null }
router.patch('/:id', requireRole(['admin', 'manager']), (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const toUpdate: Record<string, any> = {};
    if (name !== undefined) toUpdate.name = name.trim();
    if (description !== undefined) toUpdate.description = description ?? null;

    if (Object.keys(toUpdate).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check for duplicate name when renaming
    if (toUpdate.name) {
      const dup = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?').get(toUpdate.name, id);
      if (dup) {
        return res.status(409).json({ error: `La catégorie "${toUpdate.name}" existe déjà` });
      }
    }

    const cols = Object.keys(toUpdate);
    const vals = Object.values(toUpdate);
    const setClause = cols.map(c => `"${c}" = ?`).join(', ');
    db.prepare(`UPDATE categories SET ${setClause} WHERE id = ?`).run(...vals, id);

    const updated = db.prepare('SELECT id, name, description, created_at FROM categories WHERE id = ?').get(id);
    if (!updated) return res.status(404).json({ error: 'Category not found' });
    res.json(updated);
  } catch (error: any) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Une catégorie avec ce nom existe déjà' });
    }
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// ── DELETE /api/categories/:id ────────────────────────────────────────
// Delete a category. Products in that category are moved to the first
// available category so no product is left orphaned.
router.delete('/:id', requireRole(['admin', 'manager']), (req, res) => {
  try {
    const { id } = req.params;
    if (typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid category id' });
    }
    const categoryId = parseInt(id, 10);

    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    // Prevent deletion of the last remaining category (always need at least one)
    const count = db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number };
    if (count.c <= 1) {
      return res.status(409).json({ error: 'Cannot delete the last remaining category' });
    }

    // Find first fallback category (not the one being deleted)
    const fallback = db.prepare('SELECT id FROM categories WHERE id != ? ORDER BY id ASC LIMIT 1').get(categoryId) as { id: number } | undefined;
    if (!fallback) {
      return res.status(409).json({ error: 'No fallback category available' });
    }

    const transaction = db.transaction(() => {
      // Reassign products
      db.prepare('UPDATE products SET category_id = ? WHERE category_id = ?').run(fallback.id, categoryId);

      // Delete the category
      const result = db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
      return result.changes > 0;
    });

    const ok = transaction();
    if (!ok) return res.status(404).json({ error: 'Category not found' });

    res.json({ success: true, message: 'Category deleted and products reassigned' });
  } catch (error: any) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
