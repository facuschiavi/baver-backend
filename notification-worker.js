/**
 * notification-worker.js
 * Proceso PM2 separado.
 * - Cada 30s: procesa event_log (notificaciones por acción)
 * - Cada 60s: procesa cron_jobs (mails programados: resumen, cierre, recordatorios)
 */
require('dotenv').config({ path: __dirname + '/.env' });
const { Pool } = require('pg');
const { processPendingNotifications, processCronJobs } = require('./plugins/notifications');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

global._pool = pool;

const POLL_MS = 30_000;
const CRON_POLL_MS = 60_000;

console.log('[notification-worker] Starting...');

async function tick() {
  try { await processPendingNotifications(pool); } catch (e) { console.error('[worker] err:', e.message); }
}
async function cronTick() {
  try { await processCronJobs(pool); } catch (e) { console.error('[cron] err:', e.message); }
}

tick().then(() => {
  setInterval(tick, POLL_MS);
  console.log(`[notification-worker] Event poll every ${POLL_MS/1000}s`);
});

cronTick().then(() => {
  setInterval(cronTick, CRON_POLL_MS);
  console.log(`[notification-worker] Cron poll every ${CRON_POLL_MS/1000}s`);
});