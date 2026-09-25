# Tres Pilares LinkedIn Sync

Microservicio aislado para la integración oficial de LinkedIn con el CRM de Tres Pilares.

## Estado

La base está preparada para OAuth 2.0, almacenamiento cifrado de tokens y sincronización futura. Las capacidades de invitaciones, conexiones y mensajes permanecen **deshabilitadas** hasta que LinkedIn otorgue explícitamente los permisos correspondientes.

LinkedIn restringe Invitations API y Connections API a desarrolladores/partners aprobados. El acceso abierto no implica permiso para automatizar prospección.

## Responsabilidades

- Autorizar la cuenta de LinkedIn de Tres Pilares / Juan David mediante OAuth oficial.
- Guardar tokens cifrados en PostgreSQL.
- Exponer estado de conexión al CRM mediante una ruta interna.
- Servir como frontera técnica para futuras capacidades aprobadas de:
  - Invitations API
  - Connections API
  - Messages API
- Mantener la lógica de LinkedIn fuera del API principal del CRM.

## Endpoints

Públicos:
- `GET /health`
- `GET /oauth/linkedin`
- `GET /oauth/linkedin/callback`

Internos:
- `GET /internal/status`
- `POST /internal/mark-sync`

Los endpoints internos requieren `X-Internal-Key: LINKEDIN_SYNC_INTERNAL_KEY`.

## Variables

```bash
DATABASE_URL=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://<dominio>/oauth/linkedin/callback
LINKEDIN_SCOPES=openid profile email
LINKEDIN_STATE_SECRET=
LINKEDIN_TOKEN_ENCRYPTION_KEY=
LINKEDIN_SYNC_INTERNAL_KEY=
CRM_RETURN_URL=https://tres-pilares-api-production.up.railway.app/crm/
```

`LINKEDIN_TOKEN_ENCRYPTION_KEY` debe ser una clave hexadecimal de 64 caracteres.

## Fases

### Fase 1 — OAuth
Crear la LinkedIn Developer App, asociar una LinkedIn Page válida y configurar Client ID, Client Secret y redirect URI.

### Fase 2 — Permisos
Revisar los productos disponibles dentro de la app. OpenID puede usarse para autenticación básica; Invitations/Connections/Messages solo se habilitan cuando LinkedIn aprueba el acceso correspondiente.

### Fase 3 — CRM sync
Cuando LinkedIn conceda permisos:
- detectar invitaciones aceptadas;
- mover `engaged → connected`;
- cerrar follow-ups;
- crear tarea de primer DM;
- registrar actividad;
- nunca enviar outreach masivo o no autorizado.

## Seguridad

- No se almacenan tokens en texto plano.
- No se exponen secretos al frontend.
- No se implementa scraping ni automatización del navegador.
- Las capacidades restringidas están bloqueadas por diseño hasta tener permiso oficial.
