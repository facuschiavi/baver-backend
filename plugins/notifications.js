const { Resend } = require('resend');
const cronParser = require('cron-parser');

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── HELPERS ──────────────────────────────────────────────────────

function safe(val) {
  return (val === null || val === undefined || val === '') ? '—' : String(val);
}

function money(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function date(d) {
  return d ? new Date(d).toLocaleDateString('es-AR') : '—';
}

function todayStr() {
  return new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}


function sanitizeTemplateHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '');
}

function renderString(str, data) {
  return String(str || '').replace(/{{\s*([a-zA-Z0-9_.$-]+)\s*}}/g, (_, key) => {
    const parts = key.split('.');
    let val = data;
    for (const part of parts) val = val && typeof val === 'object' ? val[part] : undefined;
    return safe(val);
  });
}

function renderCustomTemplate(template, data) {
  return {
    subject: renderString(template.subject || template.name || 'Notificacion', data),
    html: sanitizeTemplateHtml(renderString(template.html_body, data)),
    text: renderString(template.text_body || '', data),
  };
}

function sampleTemplateData() {
  return {
    business_name: 'Demo Retail', address: 'Direccion comercial', phone: '0264 000000',
    order_number: 'NV-000123', total: '$125.000,00', created_at: new Date().toISOString(),
    invoice_number: '0001-00001234', invoice_type: 'Factura B', cae: '12345678901234',
    product_name: 'Producto demo', stock: '3', min_stock: '5',
    sales_count: 4, sales_total: '$420.000,00', payments_count: 6, payments_total: '$380.000,00',
    expenses_count: 2, expenses_total: '$75.000,00', net_total: '$305.000,00',
    cash_in: '$380.000,00', cash_out: '$75.000,00', cash_balance: '$305.000,00',
    low_stock_count: 3, work_orders_count: 5, pending_orders_count: 7,
  };
}


const VARIABLE_FIELD_ALLOWLIST = {
  client: ['business_name','business_email','phone','address','whatsapp','fiscal_name','fiscal_cuit'],
  payload: ['order_number','invoice_number','invoice_type','cae','total','created_at','product_name','stock','min_stock','contact_email','email','name','status','description'],
  order: ['order_number','total','created_at','updated_at','notes'],
  contact: ['name','email','phone','cuit','address'],
  product: ['name','sku','stock_quantity','min_stock','price'],
  static: ['value'],
};

function normalizeVarCode(code) {
  return String(code || '').trim().replace(/[{}]/g, '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function idFromPayload(payload, names) {
  for (const n of names) if (payload && payload[n] !== undefined && payload[n] !== null) return payload[n];
  return null;
}

async function resolveCustomVariables(pool, clientId, eventType, baseData, payload = {}) {
  const vars = await pool.query(
    `SELECT * FROM notification_variables
      WHERE is_active=true AND (client_id=$1 OR client_id IS NULL)
        AND ('all'=ANY(applies_to) OR $2=ANY(applies_to))
      ORDER BY is_system DESC, label ASC`,
    [clientId, eventType || 'all']
  );
  const out = { ...baseData };
  for (const v of vars.rows) {
    const code = normalizeVarCode(v.code);
    const entity = v.source_entity;
    const field = v.source_field;
    if (!code) continue;
    if (!VARIABLE_FIELD_ALLOWLIST[entity]?.includes(field || (entity === 'static' ? 'value' : ''))) continue;
    try {
      if (entity === 'static') out[code] = v.default_value || '';
      else if (entity === 'client') out[code] = baseData[field] ?? v.default_value ?? '';
      else if (entity === 'payload') out[code] = payload[field] ?? baseData[field] ?? v.default_value ?? '';
      else if (entity === 'order') {
        const id = idFromPayload(payload, ['order_id','id']);
        if (id) {
          const r = await pool.query(`SELECT ${field} FROM orders WHERE id=$1 AND client_id=$2 LIMIT 1`, [id, clientId]);
          out[code] = r.rows[0]?.[field] ?? v.default_value ?? '';
        }
      } else if (entity === 'contact') {
        let id = idFromPayload(payload, ['contact_id','client_contact_id']);
        if (!id) {
          const orderId = idFromPayload(payload, ['order_id','id']);
          if (orderId) id = (await pool.query('SELECT contact_id FROM orders WHERE id=$1 AND client_id=$2 LIMIT 1', [orderId, clientId])).rows[0]?.contact_id;
        }
        if (id) {
          const r = await pool.query(`SELECT ${field} FROM contacts WHERE id=$1 AND client_id=$2 LIMIT 1`, [id, clientId]);
          out[code] = r.rows[0]?.[field] ?? v.default_value ?? '';
        }
      } else if (entity === 'product') {
        const id = idFromPayload(payload, ['product_id','id']);
        if (id) {
          const r = await pool.query(`SELECT ${field} FROM products WHERE id=$1 AND client_id=$2 LIMIT 1`, [id, clientId]);
          out[code] = r.rows[0]?.[field] ?? v.default_value ?? '';
        }
      }
    } catch (e) {
      out[code] = v.default_value || '';
    }
  }
  return out;
}

async function getCronData(pool, clientId, eventType, branding) {
  const base = { ...branding, today: todayStr() };
  if (eventType === 'daily_summary') {
    const [sales, payments, expenses] = await Promise.all([
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(total),0)::numeric as total FROM orders WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND deleted_at IS NULL", [clientId]),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(op.amount),0)::numeric as total FROM order_payments op JOIN orders o ON o.id=op.order_id WHERE o.client_id=$1 AND op.paid_at::date = CURRENT_DATE", [clientId]),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(total),0)::numeric as total FROM expenses WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND deleted_at IS NULL", [clientId]),
    ]);
    const s=sales.rows[0], p=payments.rows[0], e=expenses.rows[0];
    const net=Number(p.total)-Number(e.total);
    return { ...base, sales_count:s.count, sales_total:money(s.total), payments_count:p.count, payments_total:money(p.total), expenses_count:e.count, expenses_total:money(e.total), net_total:money(net) };
  }
  if (eventType === 'daily_cash_close') {
    const [cashIn, cashOut] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric as total FROM cash_movements WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND type='in' AND deleted_at IS NULL", [clientId]),
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric as total FROM cash_movements WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND type='out' AND deleted_at IS NULL", [clientId]),
    ]);
    const ci=Number(cashIn.rows[0]?.total||0), co=Number(cashOut.rows[0]?.total||0);
    return { ...base, cash_in:money(ci), cash_out:money(co), cash_balance:money(ci-co) };
  }
  if (eventType === 'daily_reminders') {
    const [lowStock, workOrders, pendingOrders] = await Promise.all([
      pool.query("SELECT COUNT(*)::int as count FROM products WHERE client_id=$1 AND deleted_at IS NULL AND requires_stock=true AND stock_quantity <= min_stock", [clientId]),
      pool.query("SELECT COUNT(*)::int as count FROM work_orders WHERE client_id=$1 AND deleted_at IS NULL AND status NOT IN ('completada','cancelada')", [clientId]),
      pool.query("SELECT COUNT(*)::int as count FROM orders WHERE client_id=$1 AND deleted_at IS NULL AND payment_status_id NOT IN (SELECT id FROM payment_statuses WHERE LOWER(name) IN ('paid','pagado','completado'))", [clientId]),
    ]);
    return { ...base, low_stock_count:lowStock.rows[0]?.count||0, work_orders_count:workOrders.rows[0]?.count||0, pending_orders_count:pendingOrders.rows[0]?.count||0 };
  }
  return base;
}

// ─── EVENT TEMPLATES ──────────────────────────────────────────────

const TEMPLATES = {
  'order-confirmation': (d) => ({
    subject: `Pedido ${d.order_number} confirmado`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f8f9fa; padding: 20px; text-align: center;">
        <img src="${safe(d.logo_url)}" height="40" style="display:none" id="logo" onerror="this.style.display='none'"/>
        <h1 style="margin:0; color: #333;">${safe(d.business_name)}</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #28a745;">✓ Pedido confirmado</h2>
        <p>Tu pedido <strong>${safe(d.order_number)}</strong> fue recibido correctamente.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Fecha</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${date(d.created_at)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Total</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${money(d.total)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Estado</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">Confirmado</td></tr>
        </table>
        <p style="color: #666; font-size: 12px;">${safe(d.address)} · ${safe(d.phone)}</p>
      </div>
    </div>`,
  }),

  'invoice-notification': (d) => ({
    subject: `Factura ${safe(d.invoice_number)} disponible`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f8f9fa; padding: 20px; text-align: center;">
        <h1 style="margin:0; color: #333;">${safe(d.business_name)}</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #333;">📄 Factura disponible</h2>
        <p>Se generó la factura <strong>${safe(d.invoice_number)}</strong>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Tipo</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${safe(d.invoice_type)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Total</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${money(d.total)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Fecha</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${date(d.created_at)}</td></tr>
        </table>
        <p style="color: #666; font-size: 12px;">${safe(d.address)} · ${safe(d.phone)}</p>
      </div>
    </div>`,
  }),

  'low-stock': (d) => ({
    subject: `⚠️ Stock bajo — ${safe(d.product_name)}`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f8f9fa; padding: 20px; text-align: center;">
        <h1 style="margin:0; color: #333;">${safe(d.business_name)}</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #dc3545;">⚠️ Alerta de stock</h2>
        <p>El producto <strong>${safe(d.product_name)}</strong> tiene stock bajo.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Stock actual</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${safe(d.stock)} unidades</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Stock mínimo</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${safe(d.min_stock)} unidades</td></tr>
        </table>
        <p style="color: #666; font-size: 12px;">Auto-alerta VIB3.ia</p>
      </div>
    </div>`,
  }),

  'welcome': (d) => ({
    subject: `Bienvenido a ${safe(d.business_name)}`,
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #f8f9fa; padding: 20px; text-align: center;">
        <h1 style="margin:0; color: #333;">${safe(d.business_name)}</h1>
      </div>
      <div style="padding: 30px;">
        <h2 style="color: #333;">¡Bienvenido! ${safe(d.name)}</h2>
        <p>Tu cuenta fue creada exitosamente.</p>
        <p style="color: #666; font-size: 12px;">${safe(d.address)} · ${safe(d.phone)}</p>
      </div>
    </div>`,
  }),
};

// ─── CRON TEMPLATES ───────────────────────────────────────────────

const CRON_TEMPLATES = {
  'daily_summary': async (pool, clientId, branding) => {
    const [sales, payments, expenses] = await Promise.all([
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(total),0)::numeric as total FROM orders WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND deleted_at IS NULL", [clientId]),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(op.amount),0)::numeric as total FROM order_payments op JOIN orders o ON o.id=op.order_id WHERE o.client_id=$1 AND op.paid_at::date = CURRENT_DATE", [clientId]),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(total),0)::numeric as total FROM expenses WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND deleted_at IS NULL", [clientId]),
    ]);

    const s = sales.rows[0];
    const p = payments.rows[0];
    const e = expenses.rows[0];
    const neto = Number(p.total) - Number(e.total);

    return {
      subject: `📊 Resumen del dia — ${safe(branding.business_name)}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="margin:0; color: #333;">${safe(branding.business_name)}</h1>
          <p style="margin:4px 0 0;color:#888;font-size:13px;">${todayStr()}</p>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #333;">📊 Resumen del dia</h2>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background:#f8f9fa;"><td style="padding: 10px;"><strong>Ventas</strong></td><td style="padding: 10px;text-align:right;">${s.count} operaciones</td><td style="padding: 10px;text-align:right;color:#28a745;">${money(s.total)}</td></tr>
            <tr><td style="padding: 10px;"><strong>Cobros</strong></td><td style="padding: 10px;text-align:right;">${p.count} cobros</td><td style="padding: 10px;text-align:right;color:#28a745;">${money(p.total)}</td></tr>
            <tr style="background:#f8f9fa;"><td style="padding: 10px;"><strong>Gastos</strong></td><td style="padding: 10px;text-align:right;">${e.count} gastos</td><td style="padding: 10px;text-align:right;color:#dc3545;">${money(e.total)}</td></tr>
            <tr style="border-top:2px solid #333;"><td style="padding: 10px;"><strong>Resultado</strong></td><td style="padding: 10px;text-align:right;"></td><td style="padding: 10px;text-align:right;font-weight:700;color:${neto >= 0 ? '#28a745' : '#dc3545'};">${money(neto)}</td></tr>
          </table>
          <p style="color: #666; font-size: 12px;">${safe(branding.address)} · ${safe(branding.phone)}</p>
        </div>
      </div>`,
    };
  },

  'daily_cash_close': async (pool, clientId, branding) => {
    const [cashIn, cashOut, sessions] = await Promise.all([
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric as total FROM cash_movements WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND type='in' AND deleted_at IS NULL", [clientId]),
      pool.query("SELECT COALESCE(SUM(amount),0)::numeric as total FROM cash_movements WHERE client_id=$1 AND created_at::date = CURRENT_DATE AND type='out' AND deleted_at IS NULL", [clientId]),
      pool.query("SELECT id, opened_at, closed_at, initial_amount, final_amount FROM cash_sessions WHERE client_id=$1 AND opened_at::date = CURRENT_DATE ORDER BY opened_at DESC LIMIT 1", [clientId]),
    ]);

    const ci = Number(cashIn.rows[0]?.total || 0);
    const co = Number(cashOut.rows[0]?.total || 0);
    const ses = sessions.rows[0];
    const balance = ci - co;

    return {
      subject: `🧾 Cierre de caja — ${safe(branding.business_name)}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="margin:0; color: #333;">${safe(branding.business_name)}</h1>
          <p style="margin:4px 0 0;color:#888;font-size:13px;">Cierre — ${todayStr()}</p>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #333;">🧾 Cierre de caja</h2>
          ${ses ? `<p style="font-size:13px;color:#888;">Sesion #${ses.id}: abierta ${date(ses.opened_at)}${ses.closed_at ? ' · cerrada '+date(ses.closed_at) : ' · abierta'}</p>` : ''}
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr style="background:#f8f9fa;"><td style="padding: 10px;"><strong>Ingresos del dia</strong></td><td style="padding: 10px;text-align:right;color:#28a745;">${money(ci)}</td></tr>
            <tr><td style="padding: 10px;"><strong>Egresos del dia</strong></td><td style="padding: 10px;text-align:right;color:#dc3545;">${money(co)}</td></tr>
            <tr style="border-top:2px solid #333;background:#f8f9fa;"><td style="padding: 10px;"><strong>Saldo</strong></td><td style="padding: 10px;text-align:right;font-weight:700;color:${balance >= 0 ? '#28a745' : '#dc3545'};">${money(balance)}</td></tr>
          </table>
          <p style="color: #666; font-size: 12px;">${safe(branding.address)} · ${safe(branding.phone)}</p>
        </div>
      </div>`,
    };
  },

  'daily_reminders': async (pool, clientId, branding) => {
    const [lowStock, workOrders, pendingOrders] = await Promise.all([
      pool.query("SELECT COUNT(*)::int as count FROM products WHERE client_id=$1 AND deleted_at IS NULL AND requires_stock=true AND stock_quantity <= min_stock", [clientId]),
      pool.query("SELECT COUNT(*)::int as count FROM work_orders WHERE client_id=$1 AND deleted_at IS NULL AND status NOT IN ('completada','cancelada')", [clientId]),
      pool.query("SELECT COUNT(*)::int as count FROM orders WHERE client_id=$1 AND deleted_at IS NULL AND payment_status_id NOT IN (SELECT id FROM payment_statuses WHERE LOWER(name) IN ('paid','pagado','completado'))", [clientId]),
    ]);

    const items = [];
    if (lowStock.rows[0]?.count > 0) items.push({ icon: '⚠️', label: 'Productos con stock bajo', count: lowStock.rows[0].count });
    if (workOrders.rows[0]?.count > 0) items.push({ icon: '🔧', label: 'OT pendientes', count: workOrders.rows[0].count });
    if (pendingOrders.rows[0]?.count > 0) items.push({ icon: '📄', label: 'NV pendientes de pago', count: pendingOrders.rows[0].count });

    return {
      subject: `📌 Recordatorios — ${safe(branding.business_name)}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #f8f9fa; padding: 20px; text-align: center;">
          <h1 style="margin:0; color: #333;">${safe(branding.business_name)}</h1>
          <p style="margin:4px 0 0;color:#888;font-size:13px;">${todayStr()}</p>
        </div>
        <div style="padding: 30px;">
          <h2 style="color: #333;">📌 Recordatorios del dia</h2>
          ${items.length === 0 ? '<p style="color:#28a745;">✅ Todo en orden, sin novedades.</p>' : items.map(i => `
          <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;margin:6px 0;background:#f8f9fa;border-radius:8px;">
            <span style="font-size:20px;">${i.icon}</span>
            <div style="flex:1;"><strong>${i.label}</strong></div>
            <div style="font-weight:700;font-size:16px;">${i.count}</div>
          </div>`).join('')}
          <p style="color: #666; font-size: 12px; margin-top: 20px;">${safe(branding.address)} · ${safe(branding.phone)}</p>
        </div>
      </div>`,
    };
  },
};

// ─── MAIL SENDER ───────────────────────────────────────────────────

async function sendNotificationMail(poolRef, clientId, eventType, payload) {
  const p = poolRef || global._pool;
  const client = await p.query(
    `SELECT c.name as business_name, c.logo_url, c.address, c.phone, c.whatsapp, c.email as business_email,
            fd.razon_social as fiscal_name, fd.cuit as fiscal_cuit
       FROM clients c LEFT JOIN fiscal_data fd ON fd.client_id = c.id WHERE c.id = $1`, [clientId]
  );
  if (!client.rows[0]) return { error: 'client not found' };
  const branding = client.rows[0];
  const from = process.env.MAIL_FROM || 'VIB3 <noreply@demo.vib3.ar>';
  const settings = await p.query(
    'SELECT ns.email_enabled, ns.notify_roles, ns.template_id, nt.name AS custom_template_name, nt.subject, nt.html_body, nt.text_body FROM notification_settings ns LEFT JOIN notification_templates nt ON nt.id=ns.template_id AND (nt.client_id=ns.client_id OR nt.client_id IS NULL) WHERE ns.client_id=$1 AND ns.event_type=$2',
    [clientId, eventType]
  );
  if (settings.rows.length === 0 || !settings.rows[0].email_enabled) return { skipped: true };
  const notifyRoles = settings.rows[0].notify_roles || [];
  let recipients = [];

  const roleRecipients = notifyRoles.filter(r => r !== 'cliente');
  if (roleRecipients.length > 0) {
    const users = await p.query(
      "SELECT email FROM users WHERE client_id=$1 AND deleted_at IS NULL AND email IS NOT NULL AND email != '' AND rol = ANY($2)",
      [clientId, roleRecipients]
    );
    for (const u of users.rows) { if (u.email && !recipients.includes(u.email)) recipients.push(u.email); }
  } else if (notifyRoles.length === 0) {
    const users = await p.query(
      "SELECT email FROM users WHERE client_id=$1 AND deleted_at IS NULL AND email IS NOT NULL AND email != '' AND rol = 'admin'", [clientId]
    );
    for (const u of users.rows) { if (u.email && !recipients.includes(u.email)) recipients.push(u.email); }
  }
  if (notifyRoles.includes('cliente')) {
    const contactEmail = payload.contact_email || payload.email || null;
    if (contactEmail && !recipients.includes(contactEmail)) recipients.push(contactEmail);
  }
  if (recipients.length === 0) return { skipped: 'no recipients' };

  let emailData = { ...branding, ...payload };
  emailData = await resolveCustomVariables(p, clientId, eventType, emailData, payload);
  let subject, html;
  if (settings.rows[0].template_id && settings.rows[0].html_body) {
    ({ subject, html } = renderCustomTemplate(settings.rows[0], emailData));
  } else {
    const event = await p.query('SELECT template_name FROM notification_events WHERE event_type=$1', [eventType]);
    if (event.rows.length === 0) return { error: 'event not registered' };
    const templateName = event.rows[0].template_name;
    const templateFn = TEMPLATES[templateName];
    if (!templateFn) return { error: `template ${templateName} not found` };
    ({ subject, html } = templateFn(emailData));
  }
  const { data, error } = await resend.emails.send({ from, to: recipients, subject, html });
  if (error) { console.error(`[notification] mail error for ${eventType}:`, error); return { error: error.message }; }
  return { success: true, id: data.id, recipients };
}

// ─── CRON SCHEDULER ───────────────────────────────────────────────

async function processCronJobs(poolRef) {
  const p = poolRef || global._pool;
  const tz = 'America/Argentina/San_Juan';
  try {
    const jobs = await p.query(
      `SELECT cj.*, ce.template_name, ce.description, nt.name AS custom_template_name, nt.subject, nt.html_body, nt.text_body FROM cron_jobs cj
        JOIN cron_events ce ON ce.event_type = cj.event_type LEFT JOIN notification_templates nt ON nt.id=cj.template_id AND (nt.client_id=cj.client_id OR nt.client_id IS NULL) WHERE cj.enabled = true`
    );
    for (const job of jobs.rows) {
      try {
        const interval = cronParser.CronExpressionParser.parse(job.cron_expr, { tz });
        const prev = interval.prev();
        const prevTime = new Date(prev);
        if (job.last_run === null) {
          // First run: only fire if prev match is within last 5 min
          if (Date.now() - prevTime > 300000) continue;
        } else if (prevTime <= new Date(job.last_run)) {
          continue; // Already processed
        }
          const client = await p.query(
            'SELECT name as business_name, logo_url, address, phone, whatsapp, email FROM clients WHERE id=$1', [job.client_id]
          );
          if (!client.rows[0]) continue;
          const branding = client.rows[0];
          let subject, html;
          if (job.template_id && job.html_body) {
            ({ subject, html } = renderCustomTemplate(job, await getCronData(p, job.client_id, job.event_type, branding)));
          } else {
            const templateFn = CRON_TEMPLATES[job.event_type];
            if (!templateFn) continue;
            ({ subject, html } = await templateFn(p, job.client_id, branding));
          }

          let recipients = [];
          const roleRecipients = job.notify_roles || [];
          if (roleRecipients.length > 0) {
            const users = await p.query(
              "SELECT email FROM users WHERE client_id=$1 AND deleted_at IS NULL AND email IS NOT NULL AND email != '' AND rol = ANY($2)",
              [job.client_id, roleRecipients]
            );
            for (const u of users.rows) { if (u.email && !recipients.includes(u.email)) recipients.push(u.email); }
          }
          if (recipients.length === 0) {
            console.log(`[cron] ${job.event_type} client ${job.client_id}: no recipients`);
            await p.query('UPDATE cron_jobs SET last_run=$1 WHERE id=$2', [prev, job.id]);
            continue;
          }

          const from = process.env.MAIL_FROM || 'VIB3 <noreply@demo.vib3.ar>';
          const { data, error } = await resend.emails.send({ from, to: recipients, subject, html });
          if (error) { console.error(`[cron] ${job.event_type} client ${job.client_id}:`, error.message); }
          else { console.log(`[cron] ${job.event_type} client ${job.client_id} sent to ${recipients.length}, id=${data.id}`); }
          await p.query('UPDATE cron_jobs SET last_run=$1 WHERE id=$2', [prev, job.id]);
      } catch (err) { console.error(`[cron] error processing job ${job.id}:`, err.message); }
    }
  } catch (err) { console.error('[cron] query error:', err.message); }
}

// ─── WORKER ───────────────────────────────────────────────────────

let isProcessing = false;

async function processPendingNotifications(poolRef) {
  if (isProcessing) return;
  isProcessing = true;
  const p = poolRef || global._pool;
  try {
    const pending = await p.query(
      "SELECT id, client_id, event_type, payload, created_at FROM event_log WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT 50"
    );
    for (const row of pending.rows) {
      try {
        const result = await sendNotificationMail(p, row.client_id, row.event_type, row.payload);
        if (result.error) { await p.query('UPDATE event_log SET processed_at=NOW(), error_message=$1 WHERE id=$2', [result.error, row.id]); }
        else { await p.query('UPDATE event_log SET processed_at=NOW() WHERE id=$1', [row.id]); }
      } catch (err) { await p.query('UPDATE event_log SET processed_at=NOW(), error_message=$1 WHERE id=$2', [err.message, row.id]); }
    }
  } finally { isProcessing = false; }
}

async function emitEvent(poolRef, clientId, eventType, payload) {
  const p = poolRef || global._pool;
  await p.query('INSERT INTO event_log (client_id, event_type, payload) VALUES ($1, $2, $3)',
    [clientId, eventType, JSON.stringify(payload || {})]);
}

// ─── SETTINGS API ─────────────────────────────────────────────────

function setupNotificationRoutes(app, pool, authenticate) {
  app.get('/api/notifications/settings', authenticate, async (req, res) => {
    try {
      const events = await pool.query(`
        SELECT ns.id, ns.event_type, ns.email_enabled, ns.whatsapp_enabled, ns.telegram_enabled, ns.notify_roles, ns.template_id, nt.name AS custom_template_name, ne.description, ne.template_name
          FROM notification_settings ns JOIN notification_events ne ON ne.event_type = ns.event_type LEFT JOIN notification_templates nt ON nt.id=ns.template_id
         WHERE ns.client_id = $1 ORDER BY ne.description`, [req.user.client_id]);
      res.json({ settings: events.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/notifications/settings/:id', authenticate, async (req, res) => {
    try {
      const { email_enabled, whatsapp_enabled, telegram_enabled, notify_roles, template_id } = req.body;
      const result = await pool.query(`
        UPDATE notification_settings SET email_enabled=COALESCE($1,email_enabled), whatsapp_enabled=COALESCE($2,whatsapp_enabled),
               telegram_enabled=COALESCE($3,telegram_enabled), notify_roles=COALESCE($4,notify_roles), template_id=COALESCE($5,template_id), updated_at=NOW()
         WHERE id=$6 AND client_id=$7 RETURNING *`,
        [email_enabled, whatsapp_enabled, telegram_enabled, notify_roles, template_id, req.params.id, req.user.client_id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
      res.json({ setting: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/notifications/pending', authenticate, async (req, res) => {
    try {
      const pending = await pool.query(
        'SELECT id, event_type, payload, created_at FROM event_log WHERE client_id=$1 AND processed_at IS NULL ORDER BY created_at DESC LIMIT 100',
        [req.user.client_id]);
      res.json({ pending: pending.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── CRON endpoints ──────────────────────────────────────────

  app.get('/api/notifications/cron', authenticate, async (req, res) => {
    try {
      const jobs = await pool.query(
        'SELECT cj.*, ce.description, nt.name AS custom_template_name FROM cron_jobs cj JOIN cron_events ce ON ce.event_type=cj.event_type LEFT JOIN notification_templates nt ON nt.id=cj.template_id WHERE cj.client_id=$1 ORDER BY ce.description',
        [req.user.client_id]);
      res.json({ jobs: jobs.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/notifications/cron/:id', authenticate, async (req, res) => {
    try {
      const { cron_expr, notify_roles, enabled, template_id } = req.body;
      const result = await pool.query(
        'UPDATE cron_jobs SET cron_expr=COALESCE($1,cron_expr), notify_roles=COALESCE($2,notify_roles), enabled=COALESCE($3,enabled), template_id=COALESCE($4,template_id), updated_at=NOW() WHERE id=$5 AND client_id=$6 RETURNING *',
        [cron_expr, notify_roles, enabled, template_id, req.params.id, req.user.client_id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
      res.json({ job: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });


  // ─── VARIABLE endpoints ───────────────────────────────────────

  app.get('/api/notifications/variables', authenticate, async (req, res) => {
    try {
      const variables = await pool.query(
        `SELECT * FROM notification_variables WHERE is_active=true AND (client_id=$1 OR client_id IS NULL) ORDER BY is_system DESC, label ASC`,
        [req.user.client_id]
      );
      res.json({ variables: variables.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/variables', authenticate, async (req, res) => {
    try {
      let { label, code, description, source_entity, source_field, default_value, applies_to } = req.body;
      code = normalizeVarCode(code || label);
      source_entity = source_entity || 'payload';
      if (!label || !code) return res.status(400).json({ error: 'label y code son obligatorios' });
      if (!VARIABLE_FIELD_ALLOWLIST[source_entity]) return res.status(400).json({ error: 'origen no permitido' });
      if (source_entity !== 'static' && !VARIABLE_FIELD_ALLOWLIST[source_entity].includes(source_field)) return res.status(400).json({ error: 'campo no permitido' });
      const result = await pool.query(
        `INSERT INTO notification_variables (client_id,label,code,description,source_entity,source_field,default_value,applies_to,is_system)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING *`,
        [req.user.client_id, label, code, description || '', source_entity, source_field || null, default_value || '', applies_to?.length ? applies_to : ['all']]
      );
      res.status(201).json({ variable: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/notifications/variables/:id', authenticate, async (req, res) => {
    try {
      let { label, code, description, source_entity, source_field, default_value, applies_to, is_active } = req.body;
      if (code) code = normalizeVarCode(code);
      if (source_entity && !VARIABLE_FIELD_ALLOWLIST[source_entity]) return res.status(400).json({ error: 'origen no permitido' });
      if (source_entity && source_entity !== 'static' && source_field && !VARIABLE_FIELD_ALLOWLIST[source_entity].includes(source_field)) return res.status(400).json({ error: 'campo no permitido' });
      const result = await pool.query(
        `UPDATE notification_variables SET label=COALESCE($1,label), code=COALESCE($2,code), description=COALESCE($3,description),
           source_entity=COALESCE($4,source_entity), source_field=COALESCE($5,source_field), default_value=COALESCE($6,default_value),
           applies_to=COALESCE($7,applies_to), is_active=COALESCE($8,is_active), updated_at=NOW()
         WHERE id=$9 AND client_id=$10 AND is_system=false RETURNING *`,
        [label, code, description, source_entity, source_field, default_value, applies_to, is_active, req.params.id, req.user.client_id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado o variable de sistema' });
      res.json({ variable: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/notifications/variables/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(`UPDATE notification_variables SET is_active=false, updated_at=NOW() WHERE id=$1 AND client_id=$2 AND is_system=false RETURNING id`, [req.params.id, req.user.client_id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado o variable de sistema' });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/notifications/variable-fields', authenticate, async (req, res) => {
    res.json({ fields: VARIABLE_FIELD_ALLOWLIST });
  });

  // ─── TEMPLATE endpoints ───────────────────────────────────────

  app.get('/api/notifications/templates', authenticate, async (req, res) => {
    try {
      const templates = await pool.query(
        `SELECT * FROM notification_templates WHERE channel='email' AND is_active=true AND (client_id=$1 OR client_id IS NULL) ORDER BY is_system DESC, name ASC`,
        [req.user.client_id]
      );
      res.json({ templates: templates.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/templates', authenticate, async (req, res) => {
    try {
      const { name, subject, html_body, text_body, variables_schema } = req.body;
      if (!name || !html_body) return res.status(400).json({ error: 'name y html_body son obligatorios' });
      const result = await pool.query(
        `INSERT INTO notification_templates (client_id, name, channel, subject, html_body, text_body, variables_schema, is_system)
         VALUES ($1,$2,'email',$3,$4,$5,$6,false) RETURNING *`,
        [req.user.client_id, name, subject || '', sanitizeTemplateHtml(html_body), text_body || '', JSON.stringify(variables_schema || {})]
      );
      res.status(201).json({ template: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/notifications/templates/:id', authenticate, async (req, res) => {
    try {
      const { name, subject, html_body, text_body, variables_schema, is_active } = req.body;
      const result = await pool.query(
        `UPDATE notification_templates SET
           name=COALESCE($1,name), subject=COALESCE($2,subject), html_body=COALESCE($3,html_body),
           text_body=COALESCE($4,text_body), variables_schema=COALESCE($5,variables_schema), is_active=COALESCE($6,is_active), updated_at=NOW()
         WHERE id=$7 AND client_id=$8 AND is_system=false RETURNING *`,
        [name, subject, html_body ? sanitizeTemplateHtml(html_body) : null, text_body, variables_schema ? JSON.stringify(variables_schema) : null, is_active, req.params.id, req.user.client_id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado o template de sistema' });
      res.json({ template: result.rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/notifications/templates/:id', authenticate, async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE notification_templates SET is_active=false, updated_at=NOW() WHERE id=$1 AND client_id=$2 AND is_system=false RETURNING id`,
        [req.params.id, req.user.client_id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado o template de sistema' });
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/templates/:id/preview', authenticate, async (req, res) => {
    try {
      const tpl = await pool.query(`SELECT * FROM notification_templates WHERE id=$1 AND (client_id=$2 OR client_id IS NULL)`, [req.params.id, req.user.client_id]);
      if (!tpl.rows[0]) return res.status(404).json({ error: 'No encontrado' });
      const rendered = renderCustomTemplate(tpl.rows[0], { ...sampleTemplateData(), ...(req.body?.data || {}) });
      res.json({ preview: rendered });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/templates/:id/test', authenticate, async (req, res) => {
    try {
      const tpl = await pool.query(`SELECT * FROM notification_templates WHERE id=$1 AND (client_id=$2 OR client_id IS NULL)`, [req.params.id, req.user.client_id]);
      if (!tpl.rows[0]) return res.status(404).json({ error: 'No encontrado' });
      const to = req.body?.to || (await pool.query("SELECT email FROM users WHERE id=$1 AND client_id=$2", [req.user.id, req.user.client_id])).rows[0]?.email;
      if (!to) return res.status(400).json({ error: 'No hay email destino' });
      const rendered = renderCustomTemplate(tpl.rows[0], { ...sampleTemplateData(), ...(req.body?.data || {}) });
      const from = process.env.MAIL_FROM || 'VIB3 <noreply@demo.vib3.ar>';
      const { data, error } = await resend.emails.send({ from, to, subject: rendered.subject, html: rendered.html });
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true, id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

}

module.exports = {
  setupNotificationRoutes, emitEvent, processPendingNotifications,
  processCronJobs, sendNotificationMail, TEMPLATES, CRON_TEMPLATES,
};
