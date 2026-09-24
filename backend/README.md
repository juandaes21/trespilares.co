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

### Autenticación

El CRM no gestiona contraseñas. El acceso se delega al microservicio independiente `services/crm-auth` mediante Google OAuth.

Flujo:

1. `/api/crm/auth/google` redirige al microservicio de autenticación.
2. El usuario inicia sesión con Google.
3. Auth valida que el correo esté autorizado.
4. Auth genera un grant de un solo uso con 2 minutos de vigencia.
5. El CRM canjea el grant servidor-servidor.
6. El CRM guarda un access token firmado en una cookie HttpOnly.
7. Cada request verifica firma, expiración y que el usuario continúe activo.

Variables del backend CRM:

```bash
CRM_AUTH_SERVICE_URL=
CRM_AUTH_INTERNAL_KEY=
CRM_AUTH_JWT_SECRET=
```

`CRM_AUTH_INTERNAL_KEY` y `CRM_AUTH_JWT_SECRET` deben coincidir con los valores configurados en el microservicio Auth.

### Arquitectura de datos

- `crm_users`: identidad autorizada y roles; su ciclo de vida pertenece al microservicio Auth.
- El access token se guarda en cookie HttpOnly; no se almacenan contraseñas en el CRM.
- `crm_contacts`: relación comercial y owner.
- `crm_activities`: historial de interacciones.
- `crm_tasks`: próximas acciones.
- `crm_content_assets`: piezas de contenido con tracking.
- `crm_audit_log`: trazabilidad de operaciones.
- `appointment_requests.crm_contact_id`: vínculo agenda ↔ CRM.

La información patrimonial sensible no debe almacenarse en `crm_contacts`; el CRM comercial conserva contexto mínimo, etapa, interés y próximos pasos.


### Scoring de prospectos LinkedIn

El CRM usa un **Target Score de 0 a 100** para priorizar a quién trabajar primero. No intenta inferir patrimonio, salud, vida familiar ni capacidad de compra; usa únicamente señales profesionales públicas y contexto de interacción.

Versión inicial: `TP-LI-v1`.

- **ICP fit — 0–30:** cercanía del rol/perfil con los segmentos definidos por Tres Pilares.
- **Señal reciente — 0–25:** cambio, crecimiento, nueva responsabilidad, hito empresarial o actividad que crea un punto de entrada.
- **Relevancia de conversación — 0–20:** posibilidad de abrir una conversación auténtica sobre estructura, decisiones financieras, empresa u objetivos sin forzar un pitch.
- **Actividad en LinkedIn — 0–15:** publicaciones/interacciones recientes que permiten entrar con contexto.
- **Accesibilidad — 0–10:** claridad del perfil, contexto compartido, red profesional o facilidad de personalizar la aproximación.

Interpretación operativa:

- **85–100:** prioridad A; trabajar esta semana.
- **70–84:** prioridad B; trabajar si existe una señal o pieza de contenido pertinente.
- **55–69:** prioridad C; mantener en radar.
- **<55:** no priorizar por ahora.

Cada target debe tener `score_reason`, desglose y fecha de scoring para que el criterio sea auditable y pueda recalibrarse con datos reales de aceptación, conversación y reuniones.

Para imports puntuales desde investigación externa se puede usar temporalmente `CRM_TARGET_IMPORT_JSON`. El backend procesa el JSON de forma idempotente por `linkedin_url`; después de importar, la variable debe volver a `[]`.
