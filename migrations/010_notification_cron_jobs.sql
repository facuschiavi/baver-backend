-- ─── CRON JOBS: mails programados ───────────────────────────
CREATE TABLE IF NOT EXISTS cron_jobs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('daily_summary', 'daily_cash_close', 'daily_reminders')
  ),
  cron_expr TEXT NOT NULL,
  notify_roles TEXT[] NOT NULL DEFAULT ARRAY['admin'],
  notify_client BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, event_type)
);

CREATE TABLE IF NOT EXISTS cron_events (
  event_type TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  template_name TEXT NOT NULL
);

INSERT INTO cron_events (event_type, description, template_name) VALUES
  ('daily_summary',     'Resumen diario de ventas',        'daily_summary'),
  ('daily_cash_close',  'Cierre de caja del dia',          'daily_cash_close'),
  ('daily_reminders',   'Recordatorios y alertas del dia', 'daily_reminders')
ON CONFLICT (event_type) DO NOTHING;

-- Seed para client 1 (Demo)
INSERT INTO cron_jobs (client_id, event_type, cron_expr, notify_roles) VALUES
  (1, 'daily_summary',    '0 19 * * *', ARRAY['admin']),
  (1, 'daily_cash_close', '0 20 * * *', ARRAY['admin']),
  (1, 'daily_reminders',  '0 9 * * *',  ARRAY['admin'])
ON CONFLICT (client_id, event_type) DO NOTHING;
