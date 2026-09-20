# Tres Pilares

Sitio oficial de **Tres Pilares — Planificación Patrimonial**.

> **Protege · Construye · Proyecta**

## Stack

Sitio estático HTML/CSS/JS desplegable en **Cloudflare Workers Static Assets**. No requiere framework ni código de Worker para la versión actual.

## Estructura

```text
.
├── public/
│   ├── index.html
│   └── assets/
│       ├── css/styles.css
│       ├── js/main.js
│       └── images/
├── wrangler.jsonc
├── package.json
├── AGENTS.md
└── README.md
```

## Desarrollo local

Requiere Node.js.

```bash
npm install
npm run dev
```

Wrangler servirá los archivos de `public/` usando la misma configuración de Cloudflare que se utilizará en producción.

## Deploy manual

Primero autentica Wrangler:

```bash
npx wrangler login
```

Luego:

```bash
npm run deploy
```

La primera autenticación abre el flujo OAuth de Cloudflare en el navegador.

## Deploy automático desde GitHub

Para producción, conecta este repositorio a Cloudflare Workers Builds y usa:

- **Production branch:** `main`
- **Build command:** ninguno / no requerido
- **Deploy command:** `npm run deploy`

El dominio objetivo es **trespilares.co**. Conéctalo como Custom Domain una vez exista el Worker en la cuenta de Cloudflare.

## Agente + Cloudflare

Cloudflare recomienda combinar:
1. **Cloudflare Skills** para conocimiento persistente de plataforma.
2. **Cloudflare MCP** para operaciones de cuenta.
3. **Wrangler** para desarrollo local y deploy.

En Codex, instala el plugin oficial de Cloudflare desde `/plugins`. Si se configura MCP manualmente, el endpoint principal es:

```text
https://mcp.cloudflare.com/mcp
```

La autenticación de cuenta se completa mediante OAuth cuando se invoca por primera vez una herramienta de Cloudflare.

## Pendientes de producción

- Reemplazar placeholders del equipo por fotografías reales.
- Añadir logo y favicon definitivos.
- Conectar formulario a LeadConnector / GoHighLevel o agenda.
- Configurar `trespilares.co`.
- Añadir analítica y consentimiento/cookies si corresponde.
- Revisar privacidad y textos legales antes de captar leads.

## Marca

**Tres Pilares** es la marca principal. **Plan a Tres** funciona como su espacio de contenido y educación.
