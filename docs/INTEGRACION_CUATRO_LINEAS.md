# Tres Pilares · Rama de integración comercial (revisión)
Fecha: noviembre 2026. Dominio `trespilares.co` **todavía no adquirido**: no configurar DNS ni cambiar endpoints para darlo por existente.

## Contenido del PR
- `/soluciones/`, `/empresas/`, `/legado/`, `/brecha-pensional/`, `/educacion/` alojadas como archivos estáticos en `public/`.
- Cálculo educativo client-side (sin captura ni envío de datos personales) y diseño responsive según Book de Marca.
- CRM privado existente: nuevo campo independiente `business_line`, filtros, editor y tarjetas de resumen. Conserva `strategy` y las etapas existentes.
- Rutas relativas: se pueden usar en un subdominio temporal o preview sin disponer todavía del dominio final.

## No hacer en este PR
- NO fusionar a main sin pruebas / validación legal y revisión de políticas de datos.
- NO desplegar CRM en producción ni ejecutar migraciones fuera de entorno de prueba.
- NO activar automatizaciones externas, enviar emails o modificar registros reales.
- NO asociar campañas de captación directa o indirecta con Dominion sin análisis de requisitos aplicables.
- El código de frontend no usa ningún dominio hardcodeado.

## Prueba sugerida
1. Checkout de la rama; `npm ci` (si hay lock; si no, `npm install`) y `npm run dev` para revisión con Cloudflare Workers Static Assets.
2. Verificar accesibilidad móvil, navegación, botones y calculadoras en cada ruta.
3. En instancia de staging del CRM, validar inicio de sesión, roles admin/member/viewer, POST/PATCH/GET contactos y filtros.
4. Verificar que la columna opcional `business_line` no altera las estrategias actuales y que dashboard suma por línea.
5. Ejecutar pruebas de cálculos con casos 0%, plazo cero y tasas negativas; validar resultados contra un modelo independiente.
6. Revisar cumplimiento comercial, privacidad, tratamiento de datos, fuentes de supuestos y disclaimers.
7. Recién entonces planificar fusión, migración en ventana controlada y despliegue.

## Automatización comercial
El CRM ya dispone de tareas y seguimientos existentes. La extensión de nuevas reglas por línea (e.g. después de diagnóstico) queda pendiente; el PR no activa workers ni mensajería y no hace cambios sobre registros existentes.

## Despliegue
Frontend: Cloudflare (según `wrangler.jsonc`). Backend + CRM + Postgres: Railway. Vercel no es obligatorio ni consta proyecto de Tres Pilares activo en la cuenta revisada.
