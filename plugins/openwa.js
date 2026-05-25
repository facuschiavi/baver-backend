/**
 * openwa.js
 * Plugin de integración con OpenWA para el dashboard demo.
 * Expone rutas para QR, estado y envío de WhatsApp.
 * También exporta sendWhatsApp() para usar desde notification-worker.js
 */
const http = require('http');
const { Pool } = require('pg');

const OPENWA_URL = process.env.OPENWA_URL || 'http://localhost:2785';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || 'owa_k1_a4fb1efd3db05b4b96b960f386a8d8d3a38d387c424aff103accd167389dd2ef';

// ─── HTTP helper sin dependencias externas ─────────────────────────
function api(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(OPENWA_URL + path);
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port || 2785,
      path: url.pathname + url.search, method,
      headers: {
        'X-API-Key': OPENWA_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': payload ? payload.length : 0,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ ok: false, status: res.statusCode, data: { error: data.substring(0, 200) } }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getActiveSession() {
  const res = await api('GET', '/api/sessions');
  if (!res.ok) throw new Error(res.data?.message || 'Error al obtener sesiones');
  const sessions = res.data;
  if (!Array.isArray(sessions) || sessions.length === 0) throw new Error('No hay sesiones en OpenWA');
  // Buscar una conectada, si no, la primera
  const active = sessions.find(s => s.status === 'ready' || s.status === 'open') || sessions[0];
  return active;
}

module.exports = function (app, pool, authenticate) {
  // ─── GET /api/openwa/qr — Obtener QR ────────────────────────────
  app.get('/api/openwa/qr', authenticate, async (req, res) => {
    try {
      const session = await getActiveSession();

      if (session.status === 'ready' || session.status === 'open') {
        return res.json({ ok: true, connected: true, phone: session.phone });
      }

      // Iniciar sesión si está disconnected/created
      if (session.status === 'disconnected' || session.status === 'created') {
        await api('POST', `/api/sessions/${session.id}/start`, {}).catch(() => {});
      }

      // Esperar QR
      await new Promise(r => setTimeout(r, 3000));
      const qrRes = await api('GET', `/api/sessions/${session.id}/qr`);
      if (!qrRes.ok) throw new Error(qrRes.data?.message || 'Error al obtener QR');

      res.json({
        ok: true,
        connected: false,
        qrCode: qrRes.data.qrCode,
        sessionId: session.id,
        status: session.status,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── GET /api/openwa/status — Estado de la sesión ───────────────
  app.get('/api/openwa/status', authenticate, async (req, res) => {
    try {
      const session = await getActiveSession();
      res.json({
        ok: true,
        connected: session.status === 'ready' || session.status === 'open',
        status: session.status,
        phone: session.phone || session.pushName || null,
        sessionId: session.id,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── POST /api/openwa/disconnect — Desconectar ─────────────────
  app.post('/api/openwa/disconnect', authenticate, async (req, res) => {
    try {
      const session = await getActiveSession();
      await api('POST', `/api/sessions/${session.id}/logout`, {});
      res.json({ ok: true, message: 'Sesión desconectada' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
};

// ─── Export para notification-worker ────────────────────────────────
module.exports.sendWhatsApp = async function (to, text, refId = '') {
  const session = await getActiveSession();
  if (session.status !== 'ready' && session.status !== 'open') {
    throw new Error('WhatsApp no está conectado');
  }

  const phone = to.replace(/[^0-9]/g, '');
  const chatId = `${phone}@c.us`;

  const res = await api('POST', `/api/sessions/${session.id}/messages/send-text`, {
    chatId,
    text,
  });

  if (!res.ok) throw new Error(res.data?.message || res.data?.error || `HTTP ${res.status}`);

  // Guardar log en notification_sent
  try {
    const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await p.query(
      `INSERT INTO notification_sent (contact_phone, message_id, text, ref_id, event_type)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [phone, res.data?.messageId || '', text, refId || '', 'whatsapp']
    );
    await p.end();
  } catch (e) {
    console.error('[openwa] Error guardando log:', e.message);
  }

  return res.data;
};
