-- Update agent_capabilities for Demo notifications/mail/AFIP/system endpoints
-- 2026-05-19

WITH caps(capability, method, endpoint, description, category, params, description_detailed, usage_guide) AS (
  VALUES
  ('notifications.list_settings','GET','/api/notifications/settings','Listar configuración de notificaciones triggered por evento','notifications','{}'::jsonb,'Devuelve eventos configurables, toggles, destinatarios y template asignado.','Usar para saber qué notificaciones por suceso están activas y qué template usan.'),
  ('notifications.update_setting','PUT','/api/notifications/settings/:id','Actualizar una notificación triggered','notifications','{"email_enabled":"boolean","notify_roles":"array","template_id":"number|null"}'::jsonb,'Permite activar/desactivar email, elegir destinatarios por rol/cliente y asignar template.','Usar cuando el usuario pida cambiar quién recibe una notificación o qué plantilla usar.'),
  ('notifications.list_pending','GET','/api/notifications/pending','Listar eventos pendientes de procesamiento','notifications','{}'::jsonb,'Debug operativo del event_log sin procesar.','Usar solo para diagnóstico de notificaciones.'),
  ('notifications.list_cron','GET','/api/notifications/cron','Listar notificaciones planned/programadas','notifications','{}'::jsonb,'Devuelve jobs programados, cron_expr, destinatarios, template y estado.','Usar para consultar resúmenes/cierres/recordatorios automáticos.'),
  ('notifications.update_cron','PUT','/api/notifications/cron/:id','Actualizar notificación planned','notifications','{"enabled":"boolean","cron_expr":"string","notify_roles":"array","template_id":"number|null"}'::jsonb,'Permite configurar días/horarios con cron, destinatarios, estado y template.','Para horarios: cron 5 campos. Ej: 0 19 * * * = todos los días 19:00.'),

  ('notification_templates.list','GET','/api/notifications/templates','Listar plantillas de notificación','notifications','{}'::jsonb,'Lista plantillas base y plantillas del cliente para email.','Usar para mostrar o elegir templates asignables a notificaciones.'),
  ('notification_templates.create','POST','/api/notifications/templates','Crear plantilla de notificación','notifications','{"name":"string","subject":"string","html_body":"string","text_body":"string"}'::jsonb,'Crea plantilla editable por cliente. Usa variables {{codigo}}. Sanitiza scripts.','No insertar JS. Usar variables disponibles del diccionario.'),
  ('notification_templates.update','PUT','/api/notifications/templates/:id','Editar plantilla de notificación','notifications','{"name":"string","subject":"string","html_body":"string","text_body":"string","is_active":"boolean"}'::jsonb,'Modifica plantilla propia del cliente. Las de sistema no se editan.','Usar para cambios de copy, estilo visual o cuerpo HTML.'),
  ('notification_templates.delete','DELETE','/api/notifications/templates/:id','Desactivar plantilla de notificación','notifications','{}'::jsonb,'Soft delete/desactiva plantilla cliente.','Confirmar antes si puede afectar notificaciones asignadas.'),
  ('notification_templates.preview','POST','/api/notifications/templates/:id/preview','Previsualizar plantilla','notifications','{"data":"object opcional"}'::jsonb,'Renderiza una plantilla con datos demo o datos enviados.','Usar antes de guardar/testear para validar variables y aspecto.'),
  ('notification_templates.test','POST','/api/notifications/templates/:id/test','Enviar email de prueba de plantilla','notifications','{"to":"email","data":"object opcional"}'::jsonb,'Envía test por Resend al email indicado.','Pedir/confirmar email destino antes de enviar.'),

  ('notification_variables.list','GET','/api/notifications/variables','Listar diccionario de variables','notifications','{}'::jsonb,'Lista variables base y del cliente disponibles como {{codigo}}.','Usar para explicar qué variables puede usar un template.'),
  ('notification_variables.create','POST','/api/notifications/variables','Crear variable del diccionario','notifications','{"label":"string","code":"string","source_entity":"payload|client|order|contact|product|static","source_field":"string","default_value":"string","applies_to":"array"}'::jsonb,'Crea variable cliente-friendly con origen/campo allowlist. Sin SQL libre.','Elegir origen y campo permitido; para valores fijos usar source_entity=static.'),
  ('notification_variables.update','PUT','/api/notifications/variables/:id','Editar variable del diccionario','notifications','{"label":"string","code":"string","source_entity":"string","source_field":"string","default_value":"string","is_active":"boolean"}'::jsonb,'Edita variable propia del cliente. Las de sistema no se editan.','Mantener códigos estables si ya hay templates usándolos.'),
  ('notification_variables.delete','DELETE','/api/notifications/variables/:id','Desactivar variable del diccionario','notifications','{}'::jsonb,'Soft delete/desactiva variable cliente.','Confirmar si se usa en templates existentes.'),
  ('notification_variables.fields','GET','/api/notifications/variable-fields','Listar campos permitidos para variables','notifications','{}'::jsonb,'Devuelve allowlist de campos por origen: payload, client, order, contact, product, static.','Usar para construir variable sin exponer SQL.'),

  ('mail.status','GET','/api/mail/status','Ver estado del servicio de mail','mail','{}'::jsonb,'Verifica configuración de Resend/Mail from.','Usar para diagnóstico de envíos.'),
  ('mail.templates','GET','/api/mail/templates','Listar templates de mail legacy','mail','{}'::jsonb,'Endpoint legacy de templates de mail.','Preferir notification_templates para nuevo módulo.'),
  ('mail.send','POST','/api/mail/send','Enviar email directo','mail','{"to":"email|array","subject":"string","html":"string","text":"string"}'::jsonb,'Envía email directo vía Resend.','Usar con cuidado; para automatizaciones preferir notificaciones.'),
  ('mail.send_template','POST','/api/mail/send-template','Enviar email desde template legacy','mail','{"to":"email","template":"string","data":"object"}'::jsonb,'Envía email usando template legacy.','Preferir nuevo ABM de templates si aplica.'),

  ('afip.status','GET','/api/afip/status','Consultar estado/configuración AFIP','facturacion','{}'::jsonb,'Estado de módulo AFIP/ARCA.','Usar para diagnóstico antes de facturar.'),
  ('afip.config.get','GET','/api/afip/config','Obtener configuración AFIP','facturacion','{}'::jsonb,'Lee configuración fiscal/AFIP del cliente.','Usar para verificar ambiente y datos antes de emitir.'),
  ('afip.config.save','POST','/api/afip/config','Guardar configuración AFIP','facturacion','{"config":"object"}'::jsonb,'Actualiza configuración AFIP.','Acción sensible: confirmar datos fiscales.'),
  ('afip.points.list','GET','/api/afip/points-config','Listar puntos de venta configurados','facturacion','{}'::jsonb,'Devuelve puntos de venta AFIP configurados.','Usar antes de emitir o configurar facturación.'),
  ('afip.points.create','POST','/api/afip/points-config','Crear punto de venta AFIP','facturacion','{"point_of_sale":"number","description":"string"}'::jsonb,'Crea configuración de punto de venta.','Confirmar punto de venta antes.'),
  ('afip.points.update','PUT','/api/afip/points-config/:id','Editar punto de venta AFIP','facturacion','{"point_of_sale":"number","description":"string","is_active":"boolean"}'::jsonb,'Actualiza punto de venta.','Confirmar porque afecta emisión.'),
  ('afip.points.delete','DELETE','/api/afip/points-config/:id','Eliminar/desactivar punto de venta AFIP','facturacion','{}'::jsonb,'Elimina o desactiva punto de venta.','Acción sensible: pedir confirmación.'),
  ('afip.puntos_venta','GET','/api/afip/puntos-venta','Consultar puntos de venta AFIP','facturacion','{}'::jsonb,'Consulta puntos de venta desde AFIP/servicio.','Usar para validar configuración.'),
  ('afip.tipos_comprobante','GET','/api/afip/tipos-comprobante','Listar tipos de comprobante AFIP','facturacion','{}'::jsonb,'Devuelve tipos de comprobante soportados.','Usar para elegir factura/nota crédito.'),
  ('afip.ultimo_comprobante','GET','/api/afip/ultimo-comprobante','Consultar último comprobante AFIP','facturacion','{"point_of_sale":"number","type":"number"}'::jsonb,'Consulta último número autorizado.','Usar para diagnóstico de numeración.'),
  ('afip.comprobante','GET','/api/afip/comprobante','Consultar comprobante AFIP','facturacion','{"point_of_sale":"number","type":"number","number":"number"}'::jsonb,'Busca comprobante emitido/autorizado.','Usar para verificar emisión.'),
  ('afip.facturar','POST','/api/afip/facturar','Emitir factura AFIP para una NV','facturacion','{"order_id":"number","point_of_sale":"number","invoice_type":"number"}'::jsonb,'Emite factura electrónica para nota de venta.','Acción fiscal sensible: confirmar antes de emitir.'),
  ('afip.facturar_lote','POST','/api/afip/facturar-lote','Emitir facturas por lote','facturacion','{"order_ids":"array","point_of_sale":"number"}'::jsonb,'Emisión serial por lote con emitidas/omitidas/fallidas.','Confirmar lista antes de emitir.'),
  ('afip.notas_credito','POST','/api/afip/notas-credito','Emitir nota de crédito AFIP','facturacion','{"invoice_id":"number","motivo":"string"}'::jsonb,'Emite NC asociada a factura autorizada.','Acción fiscal sensible: confirmar motivo e importe.'),
  ('afip.facturas','GET','/api/afip/facturas','Listar facturas AFIP legacy','facturacion','{}'::jsonb,'Lista facturas emitidas.','Preferir /api/afip/invoices si se requiere historial completo.'),
  ('afip.orders','GET','/api/afip/orders','Listar órdenes facturables','facturacion','{}'::jsonb,'Lista NVs candidatas para facturar.','Usar en flujo de facturación.'),
  ('afip.order_detail','GET','/api/afip/orders/:id','Detalle de orden para AFIP','facturacion','{}'::jsonb,'Detalle fiscal de NV.','Usar antes de emitir.'),
  ('afip.libro_iva','GET','/api/afip/libro-iva','Consultar Libro IVA','facturacion','{"month":"number","year":"number"}'::jsonb,'Resumen y detalle de libro IVA por período.','Usar para reportes fiscales.'),

  ('client_modules.list','GET','/api/client-modules','Listar módulos activos del cliente','clients','{}'::jsonb,'Devuelve módulos habilitados para el cliente.','Usar para saber qué pantallas/funciones están disponibles.'),
  ('client_modules.update','PUT','/api/client-modules','Actualizar módulos del cliente','clients','{"modules":"object|array"}'::jsonb,'Activa/desactiva módulos del cliente.','Acción administrativa: confirmar.'),
  ('iva_alicuotas.list','GET','/api/iva-alicuotas','Listar alícuotas IVA','facturacion','{}'::jsonb,'Devuelve alícuotas disponibles.','Usar para productos/facturación.'),
  ('budgets.auto_expire','GET','/api/budgets/auto-expire','Ejecutar/consultar vencimiento automático de presupuestos','budgets','{}'::jsonb,'Proceso de expiración de presupuestos vencidos.','Usar para mantenimiento o diagnóstico.'),
  ('agent.knowledge','GET','/api/agent/knowledge','Consultar conocimiento del agente','agents','{}'::jsonb,'Devuelve conocimiento/instrucciones disponibles para agente.','Usar para inspección de contexto del agente alquilado.')
)
INSERT INTO agent_capabilities (client_id, capability, method, endpoint, description, category, params, description_detailed, usage_guide, is_active)
SELECT 1, capability, method, endpoint, description, category, params, description_detailed, usage_guide, true
FROM caps
ON CONFLICT (client_id, capability) DO UPDATE SET
  method = EXCLUDED.method,
  endpoint = EXCLUDED.endpoint,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  params = EXCLUDED.params,
  description_detailed = EXCLUDED.description_detailed,
  usage_guide = EXCLUDED.usage_guide,
  is_active = true;
