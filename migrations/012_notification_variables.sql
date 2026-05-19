CREATE TABLE IF NOT EXISTS notification_variables (
  id SERIAL PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  label TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  source_entity TEXT NOT NULL DEFAULT 'payload' CHECK (source_entity IN ('payload','client','order','contact','product','static')),
  source_field TEXT,
  default_value TEXT,
  applies_to TEXT[] NOT NULL DEFAULT ARRAY['all'],
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, code)
);

CREATE INDEX IF NOT EXISTS idx_notification_variables_client ON notification_variables(client_id, is_active);

INSERT INTO notification_variables (client_id, label, code, description, source_entity, source_field, default_value, applies_to, is_system) VALUES
(NULL, 'Negocio', 'business_name', 'Nombre comercial del cliente', 'client', 'business_name', '', ARRAY['all'], true),
(NULL, 'Email negocio', 'business_email', 'Email comercial del negocio', 'client', 'business_email', '', ARRAY['all'], true),
(NULL, 'Teléfono negocio', 'phone', 'Teléfono comercial del negocio', 'client', 'phone', '', ARRAY['all'], true),
(NULL, 'Dirección negocio', 'address', 'Dirección comercial del negocio', 'client', 'address', '', ARRAY['all'], true),
(NULL, 'N° pedido', 'order_number', 'Número de nota de venta/pedido', 'payload', 'order_number', '', ARRAY['order.confirmed','order.status_changed','order.payment_changed'], true),
(NULL, 'Total', 'total', 'Total de la operación', 'payload', 'total', '', ARRAY['all'], true),
(NULL, 'Nombre cliente', 'cliente_nombre', 'Nombre del contacto/cliente', 'contact', 'name', '', ARRAY['order.confirmed','invoice.created','delivery.created'], true),
(NULL, 'Email cliente', 'cliente_email', 'Email del contacto/cliente', 'contact', 'email', '', ARRAY['order.confirmed','invoice.created','delivery.created'], true),
(NULL, 'Producto', 'product_name', 'Nombre del producto', 'payload', 'product_name', '', ARRAY['low_stock'], true),
(NULL, 'Stock actual', 'stock', 'Stock actual del producto', 'payload', 'stock', '', ARRAY['low_stock'], true),
(NULL, 'Stock mínimo', 'min_stock', 'Stock mínimo configurado', 'payload', 'min_stock', '', ARRAY['low_stock'], true)
ON CONFLICT DO NOTHING;
