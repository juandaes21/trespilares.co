# Webinar Vida Socios · Tres Pilares

## Implementación
- Landing: `/webinar-vida-socios/` (en `public/webinar-vida-socios/index.html`).
- CSS y JS: `public/assets/css/webinar-vida-socios.css`, `public/assets/js/webinar-vida-socios.js`.
- Registro: `POST /api/webinars/vida-socios/registrations` en Railway (`backend/webinar.js`).
- Persistencia: tabla PostgreSQL `webinar_registrations`; contacto enlazado al CRM `crm_contacts` y actividad `webinar_registration`.
- Fuente: se conservan UTMs y referrer enviados al registrar el interés.
- Inscripción duplicada: se actualiza el registro por evento + email sin multiplicar filas de la lista.
- No se envía automáticamente un correo ni se crea un evento de Calendar. El texto público lo presenta como lista de interés.

## Checklist antes de publicar
1. **Fecha y hora confirmadas:** jueves **5 de noviembre de 2026, 5:30 p. m., Colombia (America/Bogota, UTC−5)**. Plataforma confirmada: Google Meet. Duración: 60 minutos. Enlace creado: https://meet.google.com/roj-caua-pqw. Organizador: finanzasconesco@gmail.com.
2. **Ponentes confirmados:** Giovanna Guazzo, Carolina Ospina y Juan David Escobar. Revisar fotografías, cargos y orden de presentación antes de publicación.
3. **Aprobar el tratamiento de datos personales en Colombia**: identificar de forma verificable al responsable del tratamiento, finalidad, política de privacidad completa, conservación, canal de ejercicio de derechos, información de terceros/proveedores y texto de autorización. Actualmente la landing incluye una autorización específica para información del webinar y contacto por correo, pero **no sustituye una política integral revisada jurídicamente**.
4. Comprobar despliegue de backend en Railway y `DATABASE_URL`; probar el endpoint con origen `https://trespilares.co` y un registro de prueba; comprobar que aparezca en el CRM sin afectar contactos existentes.
5. Revisar `FRONTEND_ORIGINS` en Railway: debe incluir el origen definitivo del sitio. El frontend usa `https://tres-pilares-api-production.up.railway.app`.
6. Preparar el envío del enlace de acceso y recordatorios a quienes se registren. El formulario **no envía automáticamente** invitaciones ni crea citas en Google Calendar.
7. Revisar la agenda y el ejemplo de COP $2.400 millones como **ilustración hipotética**, no diagnóstico, cotización, recomendación legal o cifra de producto.
8. Validar el copy de Vida Socios contra material contractual vigente del proveedor para cualquier afirmación más específica.
9. Hacer pruebas en móvil, teclado, formulario, validación de errores y estado de éxito.
10. Monitorizar `webinar_registration_failed` en logs de Railway y captación por UTM.

## Evento y datos logísticos
- **Título**: Vida Socios | ¿Está tu empresa preparada para continuar?
- **Fecha**: jueves 5 de noviembre de 2026.
- **Hora**: 5:30 p. m., Colombia (America/Bogota, UTC−5).
- **Ponentes:** Giovanna Guazzo, Carolina Ospina y Juan David Escobar.
- **Plataforma confirmada:** Google Meet.
- **Enlace:** https://meet.google.com/roj-caua-pqw · **Duración:** 60 minutos. No se envían correos automáticamente.
- **Formato sugerido**: charla educativa en vivo + preguntas de empresarios.
- **Audiencia**: accionistas, fundadores, socios de compañías y gerencia de empresas familiares.
- **Ruta de contenidos**: continuidad, acuerdos societarios, capital para compra de participaciones, criterios para revisar coberturas.
- **CTA**: inscripción anticipada gratuita.
- **Seguimiento comercial**: invitación al webinar → contenido educativo → conversación inicial opcional, sin vender ni presentar condiciones aseguradoras como universales.

## API

```json
POST /api/webinars/vida-socios/registrations
{
  "eventSlug": "vida-socios",
  "name": "Ana Solano",
  "email": "ana@empresa.com",
  "company": "Empresa ABC",
  "role": "socio",
  "phone": "+57 300 000 0000",
  "consent": true,
  "website": "",
  "attribution": {
    "source": "linkedin",
    "medium": "organic_social",
    "campaign": "vida_socios"
  }
}
```

**Respuesta positiva**: HTTP 201, `{"ok": true, "message": "..."}`.

Los rechazos devuelven código HTTP 400, 429, 500 o 503 y nunca generan una confirmación ficticia al visitante.
