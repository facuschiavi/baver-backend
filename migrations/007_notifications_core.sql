-- ─── NOTIFICATION SETTINGS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_settings (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  telegram_enabled BOOLEAN NOT NULL DEFAULT false,
  notify_roles TEXT[] DEFAULT '{}',  -- roles que reciben: {'admin','operator'}
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, event_type)
);

-- ─── EVENT LOG ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_log (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,  -- NULL = pendiente
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_log_pending_idx
  ON event_log (client_id, event_type) WHERE processed_at IS NULL;

-- ─── SEED: notification_events (templates disponibles) ─────────────
CREATE TABLE IF NOT EXISTS notification_events (
  event_type VARCHAR(100) PRIMARY KEY,
  description VARCHAR(255) NOT NULL,
  template_name VARCHAR(100) NOT NULL,
  default_enabled BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO notification_events (event_type, description, template_name, default_enabled) VALUES
  ('order.confirmed',      'Pedido confirmado',                  'order-confirmation',     true),
  ('order.cancelled',     'Pedido cancelado',                   'order-confirmation',     true),
  ('invoice.created',     'Factura emitida',                    'invoice-notification',   true),
  ('invoice.cancelled',   'Factura cancelada',                  'invoice-notification',   true),
  ('low_stock',           'Stock bajo mínimo',                  'low-stock',              true),
  ('budget.created',     'Presupuesto creado',                 'welcome',                true),
  ('budget.expired',     'Presupuesto vencido',                'welcome',                false),
  ('subscription.renewed','Renovación de plan',                'welcome',                true),
  ('payment.received',    'Pago recibido',                      'welcome',                true)
ON CONFLICT (event_type) DO NOTHING;

-- ─── SEED: default settings por cliente ────────────────────────────
-- Se ejecuta desde el worker, no aca
-- CREATE INDEX si no existe