import express from 'express';
import db from '../db/database';
import { TableService } from '../services/table.service';
import { requireAdminOrManager, requireAdmin } from '../middleware/auth';
import { env } from '../config/env';

const router = express.Router();

// Get tables (Role-based filtering)
router.get('/', async (req, res) => {
  const { waiter_id, role } = req.query;

  // In cloud mode SQLite may be disabled (db === null) => avoid 500, return empty list.
  if (!db) {
    console.warn('[Tables] SQLite disabled (db is null). Returning empty list for GET /tables');
    return res.status(200).json([]);
  }

  try {
    const params: any = {};
    if (waiter_id) params.waiter_id = Number(waiter_id);
    if (role) params.role = role as string;

    const tables = await TableService.getAll(params);
    res.json(tables);
  } catch (error: any) {
    console.error('[Tables] GET error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch tables' });
  }
});

// Get tables assigned to a specific waiter (for staff management)
router.get('/waiter/:waiterId', async (req, res) => {
  const { waiterId } = req.params;

  try {
    if (env.RENDER_CLOUD_MODE || env.USE_SUPABASE_TABLES) {
      // Cloud mode: use Supabase repository (stub for now)
      return res.json([]);
    }

    // Local SQLite only - lazy load
    const dbMod = await import('../db/database');
    const localDb = dbMod.db;

    const tables = localDb.prepare(`
      SELECT t.*
      FROM restaurant_tables t
      WHERE t.assigned_waiter_id = ?
      ORDER BY t.table_number
    `).all(waiterId);

    res.json(tables);
  } catch (error) {
    console.error('[Tables] GET by waiter error:', error);
    res.status(500).json({ error: 'Failed to fetch waiter tables' });
  }
});

// Open table (assign waiter and set active)
router.post('/:id/open', async (req, res) => {
  const { id } = req.params;
  const { waiter_id } = req.body;

  try {
    const tableId = Number(id);
    const waiterId = Number(waiter_id);

    // Validate permissions (would be done in middleware)
    // For now, assume valid

    const table = await TableService.openTable(tableId, waiterId);
    res.json({ table, success: true });
  } catch (error: any) {
    console.error(`[Tables] Open table error:`, error.message);
    res.status(400).json({ error: error.message });
  }
});

// Update table (Admin/Manager only)
router.patch('/:id', requireAdminOrManager, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const updatedTable = await TableService.update(Number(id), updates);
    res.json(updatedTable);
  } catch (error: any) {
    console.error('[Tables] PATCH error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Regenerate QR token (Admin/Manager only) — old token becomes invalid immediately
router.post('/:id/regenerate-qr', requireAdminOrManager, async (req, res) => {
  const { id } = req.params;

  try {
    const updatedTable = await TableService.regenerateQrToken(Number(id));
    res.json(updatedTable);
  } catch (error: any) {
    console.error('[Tables] Regenerate QR error:', error);
    res.status(400).json({ error: error.message || 'Failed to regenerate QR token' });
  }
});

// Reserve table
router.post('/:id/reserve', async (req, res) => {
  const { id } = req.params;

  try {
    const reservedTable = await TableService.reserveTable(Number(id));
    res.json(reservedTable);
  } catch (error: any) {
    console.error('[Tables] Reserve error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Mark table for cleaning
router.post('/:id/cleaning', async (req, res) => {
  const { id } = req.params;

  try {
    const cleaningTable = await TableService.markCleaning(Number(id));
    res.json(cleaningTable);
  } catch (error: any) {
    console.error('[Tables] Cleaning error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Set table available
router.post('/:id/available', async (req, res) => {
  const { id } = req.params;

  try {
    const availableTable = await TableService.setAvailable(Number(id));
    res.json(availableTable);
  } catch (error: any) {
    console.error('[Tables] Available error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Set table out of service
router.post('/:id/out-of-service', async (req, res) => {
  const { id } = req.params;

  try {
    const outOfServiceTable = await TableService.updateStatus(Number(id), 'out_of_service');
    res.json(outOfServiceTable);
  } catch (error: any) {
    console.error('[Tables] Out of service error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Create new table (Admin/Manager only)
router.post('/', requireAdminOrManager, async (req, res) => {
  const { table_number, capacity, status, assigned_waiter_id } = req.body;

  try {
    const tableData = {
      table_number: Number(table_number),
      capacity: Number(capacity) || 4,
      status: (status as any) || 'available',
      assigned_waiter_id: assigned_waiter_id ? Number(assigned_waiter_id) : null
    };

    const newTable = await TableService.create(tableData);
    res.status(201).json(newTable);
  } catch (error: any) {
    console.error('[Tables] POST error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete table (Admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const success = await TableService.delete(Number(id));
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Table not found' });
    }
  } catch (error: any) {
    console.error('[Tables] DELETE error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
