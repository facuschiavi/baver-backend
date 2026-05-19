const { Resend } = require('resend');

module.exports = function(app, pool, authenticate) {

  const resend = new Resend(process.env.RESEND_API_KEY);

  // ─── ROLE CHECKER ────────────────────────────────────────────────
  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.rol)) {
        return res.status(403).json({ error: `Permiso denegado. Roles permitidos: ${roles.join(', ')}` });
      }
      next();
    };
  }

  // ─── SEND SIMPLE EMAIL ─────────────────────────────────────────
  app.post('/api/mail/send', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
      const { to, subject, text, html } = req.body;

      if (!to || !subject || (!text && !html)) {
        return res.status(400).json({ error: 'Faltan campos: to, subject, text/html' });
      }

      const from = process.env.MAIL_FROM || 'VIB3 Demo <noreply@resend.dev>';

      const { data, error } = await resend.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        text: text || '',
        html: html || '',
      });

      if (error) {
        console.error('Resend error:', error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, id: data.id });
    } catch (err) {
      console.error('Error sending email:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── SEND TEMPLATE EMAIL ────────────────────────────────────────
  app.post('/api/mail/send-template', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
    try {
      const { to, template, data: templateData } = req.body;

      if (!to || !template) {
        return res.status(400).json({ error: 'Faltan campos: to, template' });
      }

      const html = renderTemplate(template, templateData || {});
      const subject = extractSubject(template, templateData) || `Mensaje desde VIB3 Demo`;

      const from = process.env.MAIL_FROM || 'VIB3 Demo <noreply@resend.dev>';

      const { data, error } = await resend.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      });

      if (error) {
        console.error('Resend error:', error);
        return res.status(500).json({ error: error.message });
      }

      res.json({ success: true, id: data.id });
    } catch (err) {
      console.error('Error sending template email:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── TEMPLATES ──────────────────────────────────────────────────

  const TEMPLATES = {
    'welcome': {
      subject: 'Bienvenido a VIB3 Demo',
      body: (d) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">¡Bienvenido, {{name}}!</h2>
          <p>Gracias por registrarte en <strong>VIB3 Demo</strong>.</p>
          <p>Tu cuenta está activa y lista para usar.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">Este mail fue enviado automáticamente.</p>
        </div>`,
    },
    'order-confirmation': {
      subject: 'Confirmación de pedido {{order_number}}',
      body: (d) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Pedido confirmado</h2>
          <p>Tu pedido <strong>{{order_number}}</strong> fue recibido correctamente.</p>
          <p><strong>Total:</strong> {{total}}</p>
          <p>Te avisaremos cuando esté listo para retiro / enviado.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">VIB3 Demo</p>
        </div>`,
    },
    'invoice-notification': {
      subject: 'Factura {{invoice_number}} disponible',
      body: (d) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Nueva factura</h2>
          <p>Se generó la factura <strong>{{invoice_number}}</strong> por <strong>{{total}}</strong>.</p>
          <p>Tipo: {{invoice_type}}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">VIB3 Demo</p>
        </div>`,
    },
    'low-stock': {
      subject: 'Alerta: Stock bajo - {{product_name}}',
      body: (d) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c;">⚠️ Alerta de stock</h2>
          <p>El producto <strong>{{product_name}}</strong> tiene stock bajo.</p>
          <p><strong>Stock actual:</strong> {{stock}} unidades</p>
          <p><strong>Mínimo:</strong> {{min_stock}} unidades</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">VIB3 Demo - Auto Alert</p>
        </div>`,
    },
  };

  function renderTemplate(template, data) {
    let html = TEMPLATES[template]?.body(data) || '';
    for (const [key, val] of Object.entries(data)) {
      html = html.replace(new RegExp(`{{${key}}}`, 'g'), val || '');
    }
    return html;
  }

  function extractSubject(template, data) {
    let subject = TEMPLATES[template]?.subject || 'Mensaje desde VIB3 Demo';
    for (const [key, val] of Object.entries(data)) {
      subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), val || '');
    }
    return subject;
  }

  // ─── LIST TEMPLATES ─────────────────────────────────────────────
  app.get('/api/mail/templates', authenticate, requireRole('admin', 'superadmin'), (req, res) => {
    const list = Object.entries(TEMPLATES).map(([name, t]) => ({
      name,
      subject: t.subject,
      hasBody: !!t.body,
    }));
    res.json({ templates: list });
  });

  // ─── VERIFY CONNECTION ─────────────────────────────────────────
  app.get('/api/mail/status', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY no configurada' });
    }
    res.json({
      status: 'ok',
      provider: 'resend',
      from: process.env.MAIL_FROM || 'noreply@resend.dev',
    });
  });
};