import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";

/**
 * Start automatic database backups on a schedule.
 * @param {string} dbPath - Path to the SQLite database file
 * @param {string} backupDir - Directory to store backups
 * @param {number} intervalHours - Backup interval in hours (default: 6)
 */
export function startAutoBackup(dbPath, backupDir, intervalHours = 6) {
  const maxBackups = 28;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  function performBackup() {
    try {
      if (!fs.existsSync(dbPath)) {
        console.log("[backup] Database file not found, skipping backup.");
        return;
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `backup-${stamp}.db`);

      fs.copyFileSync(dbPath, backupPath);
      console.log(`[backup] Created backup: ${path.basename(backupPath)}`);

      // Cleanup old backups — keep only the most recent maxBackups
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith("backup-") && f.endsWith(".db"))
        .sort()
        .reverse();

      if (files.length > maxBackups) {
        const toDelete = files.slice(maxBackups);
        toDelete.forEach((file) => {
          try {
            fs.unlinkSync(path.join(backupDir, file));
            console.log(`[backup] Removed old backup: ${file}`);
          } catch {
            // ignore removal errors
          }
        });
      }
    } catch (error) {
      console.error(`[backup] Backup failed: ${error?.message || error}`);
    }
  }

  // Validate interval and build cron expression
  const safeInterval = Math.max(1, Math.min(24, Number(intervalHours) || 6));
  // Run every N hours at minute 0
  const cronExpr = `0 */${safeInterval} * * *`;

  cron.schedule(cronExpr, performBackup);

  console.log(`[backup] Auto-backup scheduled every ${safeInterval} hour(s). Max backups: ${maxBackups}.`);
}
