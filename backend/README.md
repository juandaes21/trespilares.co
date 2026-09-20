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
