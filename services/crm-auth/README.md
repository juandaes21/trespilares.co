# Tres Pilares CRM Auth

Microservicio de autenticación para el CRM de Tres Pilares.

## Responsabilidades

- Login exclusivamente con Google OAuth / OpenID Connect.
- Autorizar solo usuarios previamente habilitados.
- Auto-crear el primer administrador únicamente si su email coincide con `CRM_BOOTSTRAP_ADMIN_EMAIL`.
- Emitir grants de un solo uso para entregar el login al CRM sin exponer cookies entre servicios.
- Emitir access tokens firmados (HS256) que el CRM valida localmente.
- Administrar usuarios y roles mediante endpoints internos.
- No contiene lógica de leads, agenda, LinkedIn ni planificación patrimonial.

## Endpoints públicos

- `GET /health`
- `GET /auth/google`
- `GET /auth/google/callback`

## Endpoints internos

Requieren `X-Internal-Key: CRM_AUTH_INTERNAL_KEY`.

- `POST /internal/exchange`
- `GET /internal/users`
- `POST /internal/users`
- `PATCH /internal/users/:id`

## Variables

```bash
DATABASE_URL=
CRM_GOOGLE_CLIENT_ID=
CRM_GOOGLE_CLIENT_SECRET=
CRM_GOOGLE_REDIRECT_URI=https://auth.trespilares.co/auth/google/callback
CRM_LOGIN_CALLBACK_URL=https://crm.trespilares.co/api/crm/auth/complete
CRM_BOOTSTRAP_ADMIN_EMAIL=trespilares.co@gmail.com
CRM_AUTH_INTERNAL_KEY=
CRM_AUTH_JWT_SECRET=
CRM_ACCESS_TTL_SECONDS=43200
```

`CRM_AUTH_INTERNAL_KEY` y `CRM_AUTH_JWT_SECRET` deben ser secretos aleatorios largos y diferentes entre sí.

## Flujo

1. El CRM redirige a este servicio.
2. El usuario entra con Google.
3. Auth comprueba que el email esté autorizado.
4. Auth crea un grant aleatorio de un solo uso con 2 minutos de vigencia.
5. El navegador vuelve al CRM con el grant.
6. El backend CRM canjea el grant por un access token mediante la red servidor-servidor.
7. El CRM guarda el access token en una cookie HttpOnly propia.
8. Cada request del CRM valida la firma y vuelve a comprobar que el usuario siga activo en PostgreSQL.
