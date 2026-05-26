const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook.
 * Goal: ensure packaged app includes required folders.
 * We keep it minimal and only copy what’s expected by src/main/main.js.
 */
module.exports = async function afterPack(context) {
  try {
    const appOutDir = context.appOutDir; // .../dist_electron/
    const extraDataDir = path.join(process.cwd(), 'data');

    const targetDataDir = path.join(appOutDir, 'data');

    // Copy ./data (if exists) so sqlite/db files/config are available at runtime.
    if (fs.existsSync(extraDataDir)) {
      fs.rmSync(targetDataDir, { recursive: true, force: true });
      fs.cpSync(extraDataDir, targetDataDir, { recursive: true });
      console.log('[afterPack] Copied data/ ->', targetDataDir);
    } else {
      console.log('[afterPack] data/ not found, skipping copy.');
    }
  } catch (err) {
    console.error('[afterPack] Failed:', err);
  }
};
