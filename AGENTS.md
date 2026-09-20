# Tres Pilares — Agent Instructions

## Platform
- Target Cloudflare Workers Static Assets.
- Treat `wrangler.jsonc` as the source of truth for Cloudflare deployment configuration.
- Static website files live in `public/`.
- Do not add a Worker script unless server-side behavior is actually required.
- Prefer static-asset delivery for the current marketing site.

## Commands
- Install: `npm install`
- Local preview: `npm run dev`
- Deploy: `npm run deploy`

## Brand
- Primary green: #123E32
- Deep green: #0B2E26
- Ivory: #F6F1E7
- Gold: #C6A164
- Keep the visual language sober, premium, warm and editorial.
- Core message: Protege · Construye · Proyecta.
- Tres Pilares is the main brand; Plan a Tres is the content property.

## Product boundaries
- Financial content must remain educational/general unless a qualified adviser conducts an individual assessment.
- Keep a clear disclaimer wherever lead-generation or financial education is presented.

## Deployment
- Production should deploy from the `main` branch.
- Prefer Cloudflare's Git integration or Wrangler.
- Custom domain target: `trespilares.co`.
