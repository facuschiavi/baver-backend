CREATE TABLE IF NOT EXISTS client_modules (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (client_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_client_modules_client ON client_modules(client_id);

INSERT INTO client_modules (client_id, module_key, enabled)
SELECT c.id, m.module_key, true
FROM clients c
CROSS JOIN (VALUES
  ('base'),
  ('retail'),
  ('subscriptions'),
  ('workshop'),
  ('budgets'),
  ('integrations')
) AS m(module_key)
ON CONFLICT (client_id, module_key) DO NOTHING;
