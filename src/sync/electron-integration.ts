// src/sync/electron-integration.ts
// Production integration layer for Electron main process
// Import this from src/main/main.js and call setupProductSync()

import { app } from 'electron';
import path from 'path';
import type Database from 'better-sqlite3';
import { initializeProductionSync, notifyNetworkStatus } from './production-sync-setup';

let initialized = false;

export function setupProductSync() {
  if (initialized) return;

  const dbPath = path.join(app.getPath('userData'), 'great-olive.db');
  const db = new Database(dbPath);

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[Sync] Supabase credentials missing. Sync disabled.');
    return;
  }

  // This will start the full production orchestration (scheduler + mutex + offline handling + crash recovery)
  initializeProductionSync({
    supabaseUrl,
    supabaseAnonKey,
    businessId: 'default-business',
    syncIntervalMs: 30000,
  });

  initialized = true;
  console.log('[Sync] Production sync orchestration layer active');
}

// Re-export for convenience
export { notifyNetworkStatus } from './production-sync-setup';
