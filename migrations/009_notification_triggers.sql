-- ─── TRIGGERS DE NOTIFICACIONES ─────────────────────────────────
-- Unifica todos los eventos de accion en DB triggers.
-- No toca el backend Node.

-- Funcion principal: INSERTs en tablas
CREATE OR REPLACE FUNCTION notify_event()
RETURNS TRIGGER AS $$
DECLARE
  evt_type TEXT;
  payload_data JSONB;
  cid INTEGER;
  cemail TEXT;
BEGIN
  cid := NULL; cemail := NULL; payload_data := '{}'::jsonb;

  -- ORDERS (INSERT)
  IF TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN
    evt_type := 'order.confirmed';
    payload_data := jsonb_build_object(
      'order_id', NEW.id, 'order_number', NEW.order_number,
      'contact_id', NEW.contact_id, 'total', NEW.total,
      'created_at', NEW.created_at,
      'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
    );

  -- DELIVERIES (INSERT)
  ELSIF TG_TABLE_NAME = 'deliveries' AND TG_OP = 'INSERT' THEN
    evt_type := 'delivery.created';
    payload_data := jsonb_build_object(
      'delivery_id', NEW.id, 'order_id', NEW.order_id,
      'contact_id', NEW.contact_id, 'address', NEW.address,
      'scheduled_date', NEW.scheduled_date,
      'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
    );

  -- WORK ORDERS (INSERT)
  ELSIF TG_TABLE_NAME = 'work_orders' AND TG_OP = 'INSERT' THEN
    evt_type := 'work_order.created';
    payload_data := jsonb_build_object(
      'work_order_id', NEW.id, 'order_id', NEW.order_id,
      'contact_id', NEW.contact_id, 'title', NEW.title,
      'status', NEW.status,
      'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
    );

  -- ORDER PAYMENTS (INSERT)
  ELSIF TG_TABLE_NAME = 'order_payments' AND TG_OP = 'INSERT' THEN
    evt_type := 'payment.received';
    cid := (SELECT client_id FROM orders WHERE id = NEW.order_id);
    cemail := (SELECT c.email FROM orders o JOIN contacts c ON c.id = o.contact_id WHERE o.id = NEW.order_id);
    payload_data := jsonb_build_object(
      'payment_id', NEW.id, 'order_id', NEW.order_id,
      'amount', NEW.amount, 'paid_at', NEW.paid_at,
      'contact_email', cemail
    );

  -- ADVANCES (INSERT — no tiene client_id directo)
  ELSIF TG_TABLE_NAME = 'advances' AND TG_OP = 'INSERT' THEN
    cid := (SELECT client_id FROM contacts WHERE id = NEW.entity_id AND NEW.entity_type = 'contact');
    cemail := (SELECT email FROM contacts WHERE id = NEW.entity_id AND NEW.entity_type = 'contact');
    IF cid IS NULL THEN RETURN NEW; END IF;
    evt_type := 'advance.created';
    payload_data := jsonb_build_object(
      'advance_id', NEW.id, 'entity_id', NEW.entity_id,
      'amount', NEW.amount, 'remaining', NEW.remaining,
      'created_at', NEW.created_at, 'contact_email', cemail
    );

  -- AFIP INVOICES (INSERT con resultado Aprobado)
  ELSIF TG_TABLE_NAME = 'afip_invoices' AND TG_OP = 'INSERT' AND NEW.result = 'A' THEN
    evt_type := 'invoice.created';
    cemail := (SELECT c.email FROM orders o JOIN contacts c ON c.id = o.contact_id WHERE o.id = NEW.order_id);
    payload_data := jsonb_build_object(
      'invoice_id', NEW.id, 'invoice_number', NEW.invoice_number,
      'invoice_type', NEW.invoice_type, 'cae', NEW.cae,
      'total', NEW.total, 'order_id', NEW.order_id,
      'created_at', NEW.authorized_at, 'contact_email', cemail
    );
  END IF;

  IF evt_type IS NOT NULL THEN
    BEGIN
      INSERT INTO event_log (client_id, event_type, payload)
      VALUES (COALESCE(NEW.client_id, cid), evt_type, payload_data);
    EXCEPTION WHEN OTHERS THEN
      -- Never break original transaction
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ORDER STATUS / PAYMENT CHANGES (UPDATE)
CREATE OR REPLACE FUNCTION notify_order_update_event()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.order_status_id IS DISTINCT FROM NEW.order_status_id THEN
    BEGIN
      INSERT INTO event_log (client_id, event_type, payload)
      VALUES (NEW.client_id, 'order.status_changed',
        jsonb_build_object(
          'order_id', NEW.id, 'order_number', NEW.order_number,
          'contact_id', NEW.contact_id, 'order_status_id', NEW.order_status_id,
          'total', NEW.total,
          'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
        )
      );
    EXCEPTION WHEN OTHERS THEN END;
  END IF;

  IF OLD.payment_status_id IS DISTINCT FROM NEW.payment_status_id THEN
    BEGIN
      INSERT INTO event_log (client_id, event_type, payload)
      VALUES (NEW.client_id, 'order.payment_changed',
        jsonb_build_object(
          'order_id', NEW.id, 'order_number', NEW.order_number,
          'contact_id', NEW.contact_id, 'payment_status_id', NEW.payment_status_id,
          'total', NEW.total,
          'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
        )
      );
    EXCEPTION WHEN OTHERS THEN END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DELIVERY / WORK ORDER STATUS CHANGES (UPDATE)
CREATE OR REPLACE FUNCTION notify_status_update_event()
RETURNS TRIGGER AS $$
DECLARE
  tbl TEXT := TG_TABLE_NAME;
  evt_type TEXT;
  the_status TEXT;
BEGIN
  IF tbl = 'deliveries' AND OLD.order_status_id IS DISTINCT FROM NEW.order_status_id THEN
    evt_type := 'delivery.status_changed';
    the_status := NEW.order_status_id::TEXT;
  ELSIF tbl = 'work_orders' AND OLD.status IS DISTINCT FROM NEW.status THEN
    evt_type := 'work_order.status_changed';
    the_status := NEW.status;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO event_log (client_id, event_type, payload)
    VALUES (NEW.client_id, evt_type,
      jsonb_build_object(
        'id', NEW.id, 'order_id', NEW.order_id,
        'contact_id', NEW.contact_id, 'status', the_status,
        'title', CASE WHEN tbl = 'work_orders' THEN NEW.title ELSE NULL END,
        'address', CASE WHEN tbl = 'deliveries' THEN NEW.address ELSE NULL END,
        'contact_email', (SELECT email FROM contacts WHERE id = NEW.contact_id)
      )
    );
  EXCEPTION WHEN OTHERS THEN END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- LOW STOCK (UPDATE stock_quantity)
CREATE OR REPLACE FUNCTION notify_low_stock_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requires_stock AND NEW.stock_quantity <= NEW.min_stock
     AND (OLD.stock_quantity IS NULL OR OLD.stock_quantity > NEW.min_stock)
  THEN
    BEGIN
      INSERT INTO event_log (client_id, event_type, payload)
      VALUES (NEW.client_id, 'low_stock',
        jsonb_build_object(
          'product_id', NEW.id, 'product_name', NEW.name,
          'stock', NEW.stock_quantity, 'min_stock', NEW.min_stock
        )
      );
    EXCEPTION WHEN OTHERS THEN END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- CREACION DE TRIGGERS
-- ═══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_notify_order_insert ON orders;
CREATE TRIGGER trg_notify_order_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_order_update ON orders;
CREATE TRIGGER trg_notify_order_update
  AFTER UPDATE OF order_status_id, payment_status_id ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_order_update_event();

DROP TRIGGER IF EXISTS trg_notify_delivery_insert ON deliveries;
CREATE TRIGGER trg_notify_delivery_insert
  AFTER INSERT ON deliveries
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_delivery_status ON deliveries;
CREATE TRIGGER trg_notify_delivery_status
  AFTER UPDATE OF order_status_id ON deliveries
  FOR EACH ROW EXECUTE FUNCTION notify_status_update_event();

DROP TRIGGER IF EXISTS trg_notify_work_order_insert ON work_orders;
CREATE TRIGGER trg_notify_work_order_insert
  AFTER INSERT ON work_orders
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_work_order_status ON work_orders;
CREATE TRIGGER trg_notify_work_order_status
  AFTER UPDATE OF status ON work_orders
  FOR EACH ROW EXECUTE FUNCTION notify_status_update_event();

DROP TRIGGER IF EXISTS trg_notify_payment_insert ON order_payments;
CREATE TRIGGER trg_notify_payment_insert
  AFTER INSERT ON order_payments
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_advance_insert ON advances;
CREATE TRIGGER trg_notify_advance_insert
  AFTER INSERT ON advances
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_invoice_insert ON afip_invoices;
CREATE TRIGGER trg_notify_invoice_insert
  AFTER INSERT ON afip_invoices
  FOR EACH ROW EXECUTE FUNCTION notify_event();

DROP TRIGGER IF EXISTS trg_notify_low_stock ON products;
CREATE TRIGGER trg_notify_low_stock
  AFTER UPDATE OF stock_quantity ON products
  FOR EACH ROW EXECUTE FUNCTION notify_low_stock_event();
