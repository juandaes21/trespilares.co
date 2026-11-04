# Captación y CRM — ampliación de preview (sin despliegue)
Fecha: noviembre de 2026.

## Estado
En la rama y PR de revisión; **no desplegado**. El dominio `trespilares.co` no está adquirido. Ningún formulario es operativo por defecto.

## Funcionamiento previsto
- Las cuatro páginas incluyen formulario de solicitud **voluntaria** con consentimiento específico solo para responder.
- No se transmiten datos de calculadoras ni información financiera ni datos de hijos.
- `public/assets/js/comercial-config.js` mantiene `enabled:false` y `apiBase:""` por defecto.
- Backend `POST /api/commercial/interests` habilitado solo si `ENABLE_COMMERCIAL_LEADS=true`. No activar en Railway production.
- Solo con **preview backend + PostgreSQL aislados**: configurar origen permitido `FRONTEND_ORIGINS` y API URL de ese preview.
- Deduplicación por `requestId` y bloqueo por correo, registros de consentimiento y atribución.
- Creación/actualización del contacto, actividad y UNA tarea interna de seguimiento. No se envía correo ni WhatsApp, no hay marketing automatizado.
- Se preservan el campo `strategy`, los pipelines existentes y la línea principal de contactos previos.
- El equipo deberá decidir protocolo de solicitudes sin equipo asignado, SLA y retención de datos.

## Checklist de validación
- [ ] Obtener aprobación de textos comerciales, tratamientos de datos, consentimiento y aviso definitivo.
- [ ] Probar creación y deduplicación contra PostgreSQL de staging (nunca producción).
- [ ] Probar web preview → backend preview → CRM staging con cuentas ficticias.
- [ ] Probar roles del CRM; evitar exposición de información financiera en notas y actividades.
- [ ] Verificar limitación de solicitudes, antifraude, CSP, HTTPS y logs sin PII.
- [ ] Ajustar `LEAD_DEFAULT_OWNER_EMAIL` **solo en staging** o asignación manual.
- [ ] Probar calendarios existentes sin cambiar su comportamiento.
- [ ] Si se activa comercialmente, revisar las restricciones de productos externos como Dominion.

## Configuración sugerida SOLO para staging
```
ENABLE_COMMERCIAL_LEADS=true
FRONTEND_ORIGINS=https://<preview-verificado>.vercel.app
LEAD_DEFAULT_OWNER_EMAIL=<cuenta-autorizada-de-prueba>
DATABASE_URL=<postgres-staging-aislado>
```
El `apiBase` de la web debe ser URL HTTPS del backend staging. No usar el backend production desde previews. No existe un proxy en Cloudflare automáticamente.

## Estado de automatizaciones
Las automatizaciones nuevas son exclusivamente **tareas internas**, disparadas al solicitar una conversación, con idempotencia y sin contacto automático. Las campañas por email o WhatsApp y los seguimientos programados externos permanecen fuera de alcance.

## Seguridad
El rate-limit actual es por proceso; para exposición pública se necesita un límite compartido/edge y mitigación anti-bot durable. No almacenar escenarios de pension/educación ni enviar mensajes sin autorización independiente.
