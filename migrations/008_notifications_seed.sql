-- ─── NUEVOS EVENT TYPES ─────────────────────────────────────────
INSERT INTO notification_events (event_type, description, template_name, default_enabled) VALUES
  ('order.status_changed',     'Cambio de estado de NV',        'order-confirmation',  true),
  ('order.payment_changed',   'Cambio de pago de NV',           'order-confirmation',  true),
  ('delivery.created',        'Entrega creada',                 'order-confirmation',  true),
  ('delivery.status_changed', 'Cambio de estado de entrega',    'order-confirmation',  true),
  ('work_order.created',      'Orden de Trabajo creada',        'welcome',             true),
  ('work_order.status_changed','Cambio de estado de OT',        'welcome',             true),
  ('advance.created',         'Anticipo creado',                'welcome',             true)
ON CONFLICT (event_type) DO NOTHING;

-- Seed para client 1
INSERT INTO notification_settings (client_id, event_type, email_enabled, notify_roles)
  SELECT 1, event_type, default_enabled, ARRAY['admin']
  FROM notification_events
  WHERE event_type IN ('order.status_changed','order.payment_changed','delivery.created',
                       'delivery.status_changed','work_order.created','work_order.status_changed',
                       'advance.created')
  ON CONFLICT (client_id, event_type) DO NOTHING;

-- ─── PRODUCTS tiene client_id? ──────────────────────────────────
-- Verificar y agregar si no existe (algunos schemas no tienen)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='products' AND column_name='client_id') THEN
    ALTER TABLE products ADD COLUMN client_id INTEGER REFERENCES clients(id);
  END IF;
END $$;
