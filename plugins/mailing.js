const { Resend } = require('resend');

module.exports = function(app, pool, authenticate) {

  const resend = new Resend(process.env.RESEND_API_KEY);

  // ─── ROLE CHECKER ────────────────────────────────────────────────
  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || (!req.user.is_agent && !roles.includes(req.user.rol))) {
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
    'recibo-cobro-baver': {
      subject: '🧾 Recibo de pago - Baver Indumentaria Deportiva',
      body: (d) => `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9f9f9; padding: 20px;">
          <div style="background-color: #1a1a2e; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">Baver</h1>
            <p style="margin: 5px 0 0; opacity: 0.8;">Indumentaria Deportiva</p>
          </div>
          <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a1a2e; margin-top: 0;">🧾 Recibo de Cobro</h2>
            <p style="color: #666;">Hola <strong>{{cliente_nombre}}</strong>, te confirmamos que recibimos tu pago.</p>

            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Comprobante</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">#{{recibo_numero}}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Nota de Venta</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">NV #{{nv_numero}}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Fecha de pago</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">{{fecha_pago}}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Monto pagado</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #27ae60; font-size: 18px;">${{monto_pagado}}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Método de pago</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">{{metodo_pago}}</td>
              </tr>
              <tr>
                <td style="padding: 8px; color: #666;">Saldo pendiente NV</td>
                <td style="padding: 8px; font-weight: bold; color: {{#if saldo_pendiente}}#e74c3c{{else}}#27ae60{{/if}};">{{saldo_pendiente_label}}</td>
              </tr>
            </table>

            {{#if observaciones}}
            <div style="background-color: #fef9e7; padding: 12px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #f39c12;">
              <p style="margin: 0; color: #856404; font-size: 13px;"><strong>Observaciones:</strong> {{observaciones}}</p>
            </div>
            {{/if}}

            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px; text-align: center;">
              Baver Indumentaria Deportiva<br>
              Ante cualquier duda respondé a este correo o contactanos por WhatsApp.
            </p>
          </div>
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