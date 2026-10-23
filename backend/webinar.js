import express from "express";
import crypto from "node:crypto";

const EVENT_SLUG = "vida-socios";
const ALLOWED_ROLES = new Set(["socio", "fundador", "directivo", "familia", "profesional", "otro"]);
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 12;
const attempts = new Map();

const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const cleanEmail = (value) => clip(value, 200).toLowerCase();

function rateLimited(key) {
  const now = Date.now();
  // Bound in-memory counters; database remains the source of truth.
  if (attempts.size > 3000) {
    for (const [ip, value] of attempts) if (now - value.since > WINDOW_MS) attempts.delete(ip);
  }
  const bucket = attempts.get(key);
  if (!bucket || now - bucket.since > WINDOW_MS) {
    attempts.set(key, { since: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

function cleanAttribution(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    source: clip(value.source, 80),
    medium: clip(value.medium, 80),
    campaign: clip(value.campaign, 120),
    content: clip(value.content, 120),
    referrer: clip(value.referrer, 500),
    landingUrl: clip(value.landingUrl, 800)
  };
}

export async function ensureWebinarSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webinar_registrations (
      id UUID PRIMARY KEY,
      event_slug TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      consent_at TIMESTAMPTZ NOT NULL,
      consent_purpose TEXT NOT NULL DEFAULT 'webinar_event_communications',
      attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
      crm_contact_id UUID REFERENCES crm_contacts(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS webinar_event_email_idx
      ON webinar_registrations(event_slug, email);
    CREATE INDEX IF NOT EXISTS webinar_event_created_idx
      ON webinar_registrations(event_slug, created_at DESC);
  `);
}

export function createWebinarRouter({ pool }) {
  const router = express.Router();
  router.post("/vida-socios/registrations", async (req, res) => {
    const body = req.body || {};
    // Honeypot. Do not persist or contact bot submissions.
    if (clip(body.website, 500)) return res.status(201).json({ ok: true });

    const name = clip(body.name, 121);
    const email = cleanEmail(body.email);
    const company = clip(body.company, 161);
    const role = clip(body.role, 40);
    const phone = clip(body.phone, 23);
    const attribution = cleanAttribution(body.attribution);
    const consent = body.consent === true;
    if (body.eventSlug !== EVENT_SLUG) return res.status(400).json({ ok: false, error: "Evento inválido." });
    if (name.length < 2 || name.length > 120) return res.status(400).json({ ok: false, error: "Ingresa tu nombre completo." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return res.status(400).json({ ok: false, error: "Ingresa un correo electrónico válido." });
    if (!company || company.length > 160) return res.status(400).json({ ok: false, error: "Ingresa el nombre de tu empresa." });
    if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ ok: false, error: "Selecciona tu relación con la empresa." });
    if (phone && !/^\+?[0-9\s()-]{7,22}$/.test(phone)) return res.status(400).json({ ok: false, error: "Revisa el número de WhatsApp." });
    if (!consent) return res.status(400).json({ ok: false, error: "Es necesario autorizar el contacto para gestionar la inscripción." });
    if (!pool) return res.status(503).json({ ok: false, error: "El registro no está disponible temporalmente." });
    if (rateLimited(req.ip || req.socket.remoteAddress || "unknown")) {
      return res.status(429).json({ ok: false, error: "Demasiados intentos. Inténtalo más tarde." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query(
        `INSERT INTO webinar_registrations
          (id,event_slug,name,email,company,role,phone,consent_at,attribution)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8::jsonb)
         ON CONFLICT (event_slug,email) DO UPDATE
          SET name=EXCLUDED.name,
              company=EXCLUDED.company,
              role=EXCLUDED.role,
              phone=EXCLUDED.phone,
              consent_at=EXCLUDED.consent_at,
              attribution=EXCLUDED.attribution,
              updated_at=NOW()
         RETURNING id`,
        [crypto.randomUUID(), EVENT_SLUG, name, email, company, role, phone || null, JSON.stringify(attribution)]
      );

      let contactId;
      const existing = await client.query(
        `SELECT id FROM crm_contacts WHERE LOWER(email)=LOWER($1) AND archived=FALSE LIMIT 1`,
        [email]
      );
      if (existing.rowCount) {
        contactId = existing.rows[0].id;
        await client.query(
          `UPDATE crm_contacts
           SET company=COALESCE(NULLIF(company,''),$2),
               phone=COALESCE(NULLIF(phone,''),$3),
               last_contact_at=NOW(),
               updated_at=NOW(),
               last_touch=$4::jsonb
           WHERE id=$1`,
          [contactId, company, phone || null, JSON.stringify(attribution)]
        );
      } else {
        contactId = crypto.randomUUID();
        await client.query(
          `INSERT INTO crm_contacts
             (id,name,email,phone,company,source_channel,source_profile,stage,interest_pillar,
              signal,last_contact_at,first_touch,last_touch)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'engaged','Protege',$8,NOW(),$9::jsonb,$9::jsonb)`,
          [contactId, name, email, phone || null, company,
           attribution.source || "website", "webinar_vida_socios",
           "Interés registrado en webinar de continuidad empresarial / Vida Socios",
           JSON.stringify(attribution)]
        );
      }

      await client.query(
        `INSERT INTO crm_activities(id,contact_id,type,direction,summary,metadata)
         VALUES ($1,$2,'webinar_registration','inbound',$3,$4::jsonb)`,
        [crypto.randomUUID(), contactId, "Interés en webinar Vida Socios",
         JSON.stringify({ eventSlug: EVENT_SLUG, registrationId: saved.rows[0].id, company, role })]
      );
      await client.query("UPDATE webinar_registrations SET crm_contact_id=$2 WHERE id=$1",
        [saved.rows[0].id, contactId]);
      await client.query("COMMIT");
      return res.status(201).json({
        ok: true,
        message: "Tu inscripción quedó registrada para el 5 de noviembre de 2026 a las 5:30 p. m. (Colombia). Guarda el enlace de acceso que aparece en pantalla."
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("webinar_registration_failed", { code: error.code, message: error.message });
      return res.status(500).json({ ok: false, error: "No pudimos registrar tu interés. Intenta nuevamente." });
    } finally {
      client.release();
    }
  });
  return router;
}
