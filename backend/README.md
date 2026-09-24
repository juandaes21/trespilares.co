# Tres Pilares API

Backend mínimo para solicitudes de agenda de trespilares.co.

## Endpoints

- `GET /health`
- `POST /api/appointments`

### Payload

```json
{
  "name": "Nombre",
  "phone": "+57 300 000 0000",
  "topic": "Organizar mi plan financiero",
  "preferredDate": "2026-09-22",
  "preferredTime": "Mañana",
  "source": "website"
}
```

Requiere `DATABASE_URL` de PostgreSQL y `FRONTEND_ORIGINS`.


## Tres Pilares CRM

El CRM vive como una aplicación privada separada del sitio de marketing y se sirve desde el mismo servicio de API para mantener autenticación y cookies en el mismo origen.

- Frontend CRM: `/crm/`
- API privada: `/api/crm/**`
- Persistencia: PostgreSQL existente
- Integración de agenda: `appointment_requests` se enlaza automáticamente con contactos CRM
- Atribución: UTM source / medium / campaign / content + referrer
- LinkedIn workspace: tareas de comentario, conexión, DM y follow-up
- Roles: `admin`, `member`, `viewer`
- `viewer` es solo lectura

### Activación inicial

Añade en Railway:

```bash
CRM_BOOTSTRAP_TOKEN=<token-largo-y-aleatorio>
```

En el primer acceso a `/crm/`, el sistema mostrará el formulario de activación. El token solo se usa para crear al primer administrador; después el endpoint de bootstrap queda bloqueado porque ya existe un usuario.

### Arquitectura de datos

- `crm_users`: acceso y roles.
- `crm_sessions`: sesiones privadas con cookie HttpOnly.
- `crm_contacts`: relación comercial y owner.
- `crm_activities`: historial de interacciones.
- `crm_tasks`: próximas acciones.
- `crm_content_assets`: piezas de contenido con tracking.
- `crm_audit_log`: trazabilidad de operaciones.
- `appointment_requests.crm_contact_id`: vínculo agenda ↔ CRM.

La información patrimonial sensible no debe almacenarse en `crm_contacts`; el CRM comercial conserva contexto mínimo, etapa, interés y próximos pasos.
