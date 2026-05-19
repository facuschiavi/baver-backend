CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp','telegram')),
  subject TEXT,
  html_body TEXT NOT NULL,
  text_body TEXT,
  variables_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES notification_templates(id);
ALTER TABLE cron_jobs ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES notification_templates(id);

CREATE INDEX IF NOT EXISTS idx_notification_templates_client ON notification_templates(client_id, channel, is_active);

INSERT INTO notification_templates (client_id, name, channel, subject, html_body, text_body, variables_schema, is_system, is_active) VALUES
(NULL, 'Base - Confirmacion de pedido', 'email', 'Pedido {{order_number}} confirmado', '<h2>Pedido confirmado</h2><p>Pedido <strong>{{order_number}}</strong></p><p>Total: {{total}}</p><p>{{business_name}}</p>', 'Pedido {{order_number}} confirmado. Total: {{total}}', '{"variables":["business_name","order_number","total","created_at"]}', true, true),
(NULL, 'Base - Factura', 'email', 'Factura {{invoice_number}} disponible', '<h2>Factura disponible</h2><p>Factura <strong>{{invoice_number}}</strong></p><p>Total: {{total}}</p><p>CAE: {{cae}}</p>', 'Factura {{invoice_number}} disponible. Total: {{total}}', '{"variables":["business_name","invoice_number","invoice_type","cae","total"]}', true, true),
(NULL, 'Base - Stock bajo', 'email', 'Stock bajo - {{product_name}}', '<h2>Stock bajo</h2><p>{{product_name}}</p><p>Stock actual: {{stock}} / minimo: {{min_stock}}</p>', 'Stock bajo {{product_name}}: {{stock}}/{{min_stock}}', '{"variables":["business_name","product_name","stock","min_stock"]}', true, true),
(NULL, 'Base - Resumen diario', 'email', 'Resumen del dia - {{business_name}}', '<h2>Resumen del dia</h2><p>Ventas: {{sales_count}} - {{sales_total}}</p><p>Cobros: {{payments_count}} - {{payments_total}}</p><p>Gastos: {{expenses_count}} - {{expenses_total}}</p><p>Resultado: {{net_total}}</p>', 'Ventas {{sales_total}}, cobros {{payments_total}}, gastos {{expenses_total}}', '{"variables":["business_name","sales_count","sales_total","payments_count","payments_total","expenses_count","expenses_total","net_total"]}', true, true),
(NULL, 'Base - Cierre de caja', 'email', 'Cierre de caja - {{business_name}}', '<h2>Cierre de caja</h2><p>Ingresos: {{cash_in}}</p><p>Egresos: {{cash_out}}</p><p>Saldo: {{cash_balance}}</p>', 'Cierre caja: saldo {{cash_balance}}', '{"variables":["business_name","cash_in","cash_out","cash_balance"]}', true, true),
(NULL, 'Base - Recordatorios', 'email', 'Recordatorios - {{business_name}}', '<h2>Recordatorios</h2><p>Stock bajo: {{low_stock_count}}</p><p>OT pendientes: {{work_orders_count}}</p><p>NV impagas: {{pending_orders_count}}</p>', 'Stock bajo {{low_stock_count}}, OT {{work_orders_count}}, NV impagas {{pending_orders_count}}', '{"variables":["business_name","low_stock_count","work_orders_count","pending_orders_count"]}', true, true)
ON CONFLICT DO NOTHING;
