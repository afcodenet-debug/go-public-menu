/**
 * Notification Email Service (Dedicated for Scheduled Reports)
 *
 * Thin wrapper around the main notification.service to keep scheduled reports clean.
 * All heavy lifting (templates, role filtering, transport) stays in the main service.
 */

export {
  broadcastNotification,
  loadRawSettings,
  readEmailSettings,
  getDefaultEmailSettings,
} from './notification.service';

// Future: Add specific scheduled email helpers here if needed
// (e.g. buildDailyClosureEmail, sendInventoryAlert, etc.)
