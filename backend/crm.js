import express from "express";
import crypto from "node:crypto";

export const CRM_STAGES = [
  "target",
  "engaged",
  "connected",
  "conversation",
  "need_identified",
  "meeting_proposed",
  "booked",
  "showed",
  "diagnostic",
  "proposal",
  "won",
  "nurture",
  "lost"
];

const STAGE_SET = new Set(CRM_STAGES);
const TASK_TYPES = new Set([
  "linkedin_comment",
  "linkedin_connect",
  "linkedin_dm",
  "linkedin_followup",
  "whatsapp",
  "email",
  "call",
  "meeting",
  "custom"
]);
const ACTIVITY_TYPES = new Set([
  "linkedin_comment",
  "linkedin_connection",
  "linkedin_dm",
  "whatsapp",
  "email",
  "call",
  "meeting",
  "note",
  "stage_change",
  "website_booking"
]);

function cleanText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanNullable(value, max = 500) {
  const valueClean = cleanText(value, max);
  return valueClean || null;
}

function normalizeEmail(value) {
  return cleanText(value, 200).toLowerCase();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeTimingEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function scryptKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scryptKey(password, salt);
  return "scrypt$" + salt + "$" + key.toString("hex");
}

async function verifyPassword(password, stored) {
  const [algo, salt, expectedHex] = String(stored || "").split("$");
  if (algo !== "scrypt" || !salt || !expectedHex) return false;
  const key = await scryptKey(password, salt);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    teamMemberEmail: row.team_member_email || null,
    active: row.active !== false
  };
}

function setSessionCookie(res, token, maxAgeSeconds = 60 * 60 * 24 * 7) {
  res.setHeader(
    "Set-Cookie",
    "tp_crm_session=" + encodeURIComponent(token) +
      "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAgeSeconds
  );
}

async function audit(db, userId, action, entityType, entityId, metadata = {}) {
  await db.query(
    `INSERT INTO crm_audit_log(id, user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [crypto.randomUUID(), userId || null, action, entityType, entityId || null, JSON.stringify(metadata)]
  );
}

export async function ensureCrmSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_users (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      team_member_email TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS crm_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS crm_sessions_expiry_idx ON crm_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS crm_content_assets (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      platform TEXT NOT NULL DEFAULT 'linkedin',
      profile TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      published_at TIMESTAMPTZ,
      topic TEXT,
      pillar TEXT,
      cta TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      tracking_code TEXT NOT NULL UNIQUE,
      created_by UUID REFERENCES crm_users(id)
    );

    CREATE TABLE IF NOT EXISTS crm_contacts (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      title TEXT,
      linkedin_url TEXT,
      segment TEXT,
      owner_user_id UUID REFERENCES crm_users(id),
      source_channel TEXT NOT NULL DEFAULT 'manual',
      source_profile TEXT,
      source_detail TEXT,
      source_content_id UUID REFERENCES crm_content_assets(id),
      stage TEXT NOT NULL DEFAULT 'target',
      interest_pillar TEXT,
      signal TEXT,
      need_summary TEXT,
      notes TEXT,
      last_contact_at TIMESTAMPTZ,
      next_action_at TIMESTAMPTZ,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_by UUID REFERENCES crm_users(id)
    );
    CREATE INDEX IF NOT EXISTS crm_contacts_stage_idx ON crm_contacts(stage) WHERE archived = FALSE;
    CREATE INDEX IF NOT EXISTS crm_contacts_owner_idx ON crm_contacts(owner_user_id) WHERE archived = FALSE;
    CREATE INDEX IF NOT EXISTS crm_contacts_next_action_idx ON crm_contacts(next_action_at) WHERE archived = FALSE;
    CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_unique_idx
      ON crm_contacts(LOWER(email))
      WHERE email IS NOT NULL AND email <> '' AND archived = FALSE;

    CREATE TABLE IF NOT EXISTS crm_activities (
      id UUID PRIMARY KEY,
      contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'internal',
      summary TEXT NOT NULL,
      created_by UUID REFERENCES crm_users(id),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS crm_activities_contact_idx
      ON crm_activities(contact_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS crm_tasks (
      id UUID PRIMARY KEY,
      contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      due_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      assigned_user_id UUID REFERENCES crm_users(id),
      created_by UUID REFERENCES crm_users(id),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS crm_tasks_due_idx ON crm_tasks(status, due_at);
    CREATE INDEX IF NOT EXISTS crm_tasks_assignee_idx ON crm_tasks(assigned_user_id, status, due_at);

    CREATE TABLE IF NOT EXISTS crm_audit_log (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_id UUID REFERENCES crm_users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS crm_contact_id UUID REFERENCES crm_contacts(id);
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS utm_source TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS utm_medium TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS utm_content TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS referrer TEXT;
  `);
}

export async function syncAppointmentToCrm(client, data) {
  let contentId = null;
  if (data.utmContent) {
    const content = await client.query(
      "SELECT id FROM crm_content_assets WHERE tracking_code = $1 LIMIT 1",
      [data.utmContent]
    );
    contentId = content.rows[0]?.id || null;
  }

  let ownerId = null;
  if (data.assignedMemberEmail) {
    const owner = await client.query(
      "SELECT id FROM crm_users WHERE LOWER(COALESCE(team_member_email,email)) = LOWER($1) AND active = TRUE LIMIT 1",
      [data.assignedMemberEmail]
    );
    ownerId = owner.rows[0]?.id || null;
  }

  const existing = await client.query(
    `SELECT id,stage FROM crm_contacts
      WHERE archived = FALSE
        AND (
          (email IS NOT NULL AND LOWER(email) = LOWER($1))
          OR (phone IS NOT NULL AND phone = $2)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [data.email || "", data.phone || ""]
  );

  const sourceChannel = data.utmSource || data.source || "website";
  const sourceProfile = data.utmCampaign || null;
  const sourceDetail = data.utmContent || null;

  if (existing.rowCount) {
    const id = existing.rows[0].id;
    await client.query(
      `UPDATE crm_contacts
          SET name = COALESCE(NULLIF($2,''), name),
              email = COALESCE(NULLIF($3,''), email),
              phone = COALESCE(NULLIF($4,''), phone),
              owner_user_id = COALESCE(owner_user_id, $5),
              source_channel = CASE WHEN source_channel = 'manual' THEN $6 ELSE source_channel END,
              source_profile = COALESCE(source_profile, $7),
              source_detail = COALESCE(source_detail, $8),
              source_content_id = COALESCE(source_content_id, $9),
              stage = CASE
                WHEN stage IN ('target','engaged','connected','conversation','need_identified','meeting_proposed')
                  THEN 'booked'
                ELSE stage
              END,
              last_contact_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [id, data.name, data.email, data.phone, ownerId, sourceChannel, sourceProfile, sourceDetail, contentId]
    );
    await client.query(
      `INSERT INTO crm_activities(id,contact_id,type,direction,summary,metadata)
       VALUES ($1,$2,'website_booking','inbound',$3,$4::jsonb)`,
      [
        crypto.randomUUID(),
        id,
        "Cita agendada desde " + sourceChannel,
        JSON.stringify({ appointmentId:data.appointmentId, topic:data.topic })
      ]
    );
    return id;
  }

  const id = crypto.randomUUID();
  await client.query(
    `INSERT INTO crm_contacts(
      id,name,email,phone,owner_user_id,source_channel,source_profile,source_detail,source_content_id,
      stage,interest_pillar,signal,last_contact_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booked',$10,$11,NOW())`,
    [
      id,
      data.name,
      data.email || null,
      data.phone || null,
      ownerId,
      sourceChannel,
      sourceProfile,
      sourceDetail,
      contentId,
      data.topic || null,
      "Agendó una conversación inicial"
    ]
  );
  await client.query(
    `INSERT INTO crm_activities(id,contact_id,type,direction,summary,metadata)
     VALUES ($1,$2,'website_booking','inbound',$3,$4::jsonb)`,
    [
      crypto.randomUUID(),
      id,
      "Cita agendada desde " + sourceChannel,
      JSON.stringify({ appointmentId:data.appointmentId, topic:data.topic })
    ]
  );
  return id;
}

export function createCrmRouter({ pool }) {
  const router = express.Router();

  async function auth(req, res, next) {
    if (!pool) return res.status(503).json({ ok:false, error:"CRM no disponible." });
    const token = parseCookies(req).tp_crm_session;
    if (!token) return res.status(401).json({ ok:false, error:"Sesión requerida." });
    try {
      const result = await pool.query(
        `SELECT u.*
           FROM crm_sessions s
           JOIN crm_users u ON u.id = s.user_id
          WHERE s.token_hash = $1
            AND s.expires_at > NOW()
            AND u.active = TRUE
          LIMIT 1`,
        [sessionHash(token)]
      );
      if (!result.rowCount) return res.status(401).json({ ok:false, error:"Sesión vencida." });
      req.crmUser = result.rows[0];
      req.crmSessionToken = token;
      next();
    } catch (error) {
      console.error("crm_auth_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos validar la sesión." });
    }
  }

  function admin(req, res, next) {
    if (req.crmUser?.role !== "admin") {
      return res.status(403).json({ ok:false, error:"Permiso de administrador requerido." });
    }
    next();
  }

  router.get("/bootstrap-status", async (_req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false });
      const result = await pool.query("SELECT COUNT(*)::int AS count FROM crm_users");
      res.json({ ok:true, needsBootstrap:Number(result.rows[0].count) === 0 });
    } catch {
      res.status(500).json({ ok:false });
    }
  });

  router.post("/bootstrap", async (req, res) => {
    if (!pool) return res.status(503).json({ ok:false, error:"CRM no disponible." });
    const configured = String(process.env.CRM_BOOTSTRAP_TOKEN || "");
    const supplied = String(req.headers["x-bootstrap-token"] || "");
    if (!configured || !safeTimingEqual(configured, supplied)) {
      return res.status(403).json({ ok:false, error:"Token de activación inválido." });
    }
    try {
      const count = await pool.query("SELECT COUNT(*)::int AS count FROM crm_users");
      if (Number(count.rows[0].count) > 0) {
        return res.status(409).json({ ok:false, error:"El CRM ya fue inicializado." });
      }
      const name = cleanText(req.body?.name, 120);
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
        return res.status(400).json({
          ok:false,
          error:"Nombre, email y contraseña de al menos 10 caracteres son obligatorios."
        });
      }
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_users(id,name,email,password_hash,role,team_member_email)
         VALUES ($1,$2,$3,$4,'admin',$3)`,
        [id,name,email,await hashPassword(password)]
      );
      res.status(201).json({ ok:true });
    } catch (error) {
      console.error("crm_bootstrap_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos inicializar el CRM." });
    }
  });

  router.post("/auth/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    try {
      const result = await pool.query(
        "SELECT * FROM crm_users WHERE email=$1 AND active=TRUE LIMIT 1",
        [email]
      );
      const user = result.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return res.status(401).json({ ok:false, error:"Credenciales inválidas." });
      }
      const token = crypto.randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO crm_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')",
        [sessionHash(token), user.id]
      );
      setSessionCookie(res, token);
      res.json({ ok:true, user:publicUser(user) });
    } catch (error) {
      console.error("crm_login_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos iniciar sesión." });
    }
  });

  router.post("/auth/logout", auth, async (req, res) => {
    try {
      await pool.query("DELETE FROM crm_sessions WHERE token_hash=$1", [sessionHash(req.crmSessionToken)]);
    } catch {}
    setSessionCookie(res, "", 0);
    res.json({ ok:true });
  });

  router.get("/me", auth, (req, res) => {
    res.json({ ok:true, user:publicUser(req.crmUser) });
  });

  router.get("/users", auth, async (_req, res) => {
    const result = await pool.query(
      "SELECT id,name,email,role,team_member_email,active FROM crm_users ORDER BY active DESC,name"
    );
    res.json({ ok:true, users:result.rows.map(publicUser) });
  });

  router.post("/users", auth, admin, async (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const role = ["admin","member","viewer"].includes(req.body?.role) ? req.body.role : "member";
    const teamMemberEmail = normalizeEmail(req.body?.teamMemberEmail || email);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
      return res.status(400).json({
        ok:false,
        error:"Completa nombre, email y una contraseña de al menos 10 caracteres."
      });
    }
    try {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_users(id,name,email,password_hash,role,team_member_email)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id,name,email,await hashPassword(password),role,teamMemberEmail]
      );
      await audit(pool, req.crmUser.id, "create", "user", id, { email, role });
      res.status(201).json({ ok:true, id });
    } catch (error) {
      if (String(error.code) === "23505") {
        return res.status(409).json({ ok:false, error:"Ya existe un usuario con ese email." });
      }
      console.error("crm_user_create_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos crear el usuario." });
    }
  });

  router.get("/dashboard", auth, async (_req, res) => {
    try {
      const [stages,sources,owners,tasks,meetings,content] = await Promise.all([
        pool.query("SELECT stage,COUNT(*)::int AS count FROM crm_contacts WHERE archived=FALSE GROUP BY stage"),
        pool.query("SELECT source_channel,COUNT(*)::int AS count FROM crm_contacts WHERE archived=FALSE GROUP BY source_channel ORDER BY count DESC LIMIT 10"),
        pool.query(`SELECT COALESCE(u.name,'Sin asignar') AS owner,COUNT(c.*)::int AS count
                     FROM crm_contacts c
                     LEFT JOIN crm_users u ON u.id=c.owner_user_id
                    WHERE c.archived=FALSE
                    GROUP BY COALESCE(u.name,'Sin asignar')
                    ORDER BY count DESC`),
        pool.query(`SELECT
          COUNT(*) FILTER (WHERE status='open' AND due_at<NOW())::int AS overdue,
          COUNT(*) FILTER (WHERE status='open' AND due_at>=NOW() AND due_at<NOW()+INTERVAL '1 day')::int AS due_today
          FROM crm_tasks`),
        pool.query(`SELECT
          COUNT(*) FILTER (WHERE status<>'cancelled' AND start_time>=NOW() AND start_time<NOW()+INTERVAL '7 days')::int AS upcoming,
          COUNT(*) FILTER (WHERE status<>'cancelled' AND start_time>=date_trunc('month',NOW()) AND start_time<date_trunc('month',NOW())+INTERVAL '1 month')::int AS month
          FROM appointment_requests`),
        pool.query(`SELECT a.id,a.title,a.profile,a.tracking_code,COUNT(c.id)::int AS contacts
                     FROM crm_content_assets a
                     LEFT JOIN crm_contacts c ON c.source_content_id=a.id AND c.archived=FALSE
                    GROUP BY a.id
                    ORDER BY contacts DESC,a.published_at DESC NULLS LAST
                    LIMIT 8`)
      ]);
      res.json({
        ok:true,
        stages:stages.rows,
        sources:sources.rows,
        owners:owners.rows,
        tasks:tasks.rows[0],
        meetings:meetings.rows[0],
        content:content.rows
      });
    } catch (error) {
      console.error("crm_dashboard_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos cargar el dashboard." });
    }
  });

  router.get("/contacts", auth, async (req, res) => {
    const q = cleanText(req.query.q, 120);
    const stage = cleanText(req.query.stage, 40);
    const owner = cleanText(req.query.owner, 60);
    const source = cleanText(req.query.source, 60);
    const params = [];
    const where = ["c.archived=FALSE"];

    if (q) {
      params.push("%" + q + "%");
      where.push(
        "(c.name ILIKE $" + params.length +
        " OR c.email ILIKE $" + params.length +
        " OR c.company ILIKE $" + params.length +
        " OR c.title ILIKE $" + params.length + ")"
      );
    }
    if (stage && STAGE_SET.has(stage)) {
      params.push(stage);
      where.push("c.stage=$" + params.length);
    }
    if (owner) {
      params.push(owner);
      where.push("c.owner_user_id::text=$" + params.length);
    }
    if (source) {
      params.push(source);
      where.push("c.source_channel=$" + params.length);
    }

    const result = await pool.query(
      `SELECT c.*,u.name AS owner_name,a.title AS source_content_title,a.tracking_code
         FROM crm_contacts c
         LEFT JOIN crm_users u ON u.id=c.owner_user_id
         LEFT JOIN crm_content_assets a ON a.id=c.source_content_id
        WHERE ` + where.join(" AND ") +
      " ORDER BY COALESCE(c.next_action_at,c.updated_at) DESC LIMIT 500",
      params
    );
    res.json({ ok:true, contacts:result.rows });
  });

  router.post("/contacts", auth, async (req, res) => {
    const body = req.body || {};
    const name = cleanText(body.name, 160);
    if (name.length < 2) {
      return res.status(400).json({ ok:false, error:"El nombre es obligatorio." });
    }
    const stage = STAGE_SET.has(body.stage) ? body.stage : "target";
    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO crm_contacts(
          id,name,email,phone,company,title,linkedin_url,segment,owner_user_id,source_channel,
          source_profile,source_detail,source_content_id,stage,interest_pillar,signal,need_summary,
          notes,next_action_at,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          id,
          name,
          cleanNullable(body.email,200)?.toLowerCase() || null,
          cleanNullable(body.phone,40),
          cleanNullable(body.company,160),
          cleanNullable(body.title,160),
          cleanNullable(body.linkedinUrl,500),
          cleanNullable(body.segment,100),
          cleanNullable(body.ownerUserId,60),
          cleanText(body.sourceChannel || "manual",60),
          cleanNullable(body.sourceProfile,100),
          cleanNullable(body.sourceDetail,180),
          cleanNullable(body.sourceContentId,60),
          stage,
          cleanNullable(body.interestPillar,100),
          cleanNullable(body.signal,500),
          cleanNullable(body.needSummary,1500),
          cleanNullable(body.notes,4000),
          body.nextActionAt || null,
          req.crmUser.id
        ]
      );
      await pool.query(
        "INSERT INTO crm_activities(id,contact_id,type,direction,summary,created_by) VALUES ($1,$2,'note','internal','Contacto creado en CRM',$3)",
        [crypto.randomUUID(),id,req.crmUser.id]
      );
      await audit(pool, req.crmUser.id, "create", "contact", id, { source:body.sourceChannel || "manual" });
      res.status(201).json({ ok:true, id });
    } catch (error) {
      if (String(error.code) === "23505") {
        return res.status(409).json({ ok:false, error:"Ya existe un contacto activo con ese email." });
      }
      console.error("crm_contact_create_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos crear el contacto." });
    }
  });

  router.get("/contacts/:id", auth, async (req, res) => {
    try {
      const contact = await pool.query(
        `SELECT c.*,u.name AS owner_name,a.title AS source_content_title,a.tracking_code
           FROM crm_contacts c
           LEFT JOIN crm_users u ON u.id=c.owner_user_id
           LEFT JOIN crm_content_assets a ON a.id=c.source_content_id
          WHERE c.id=$1 AND c.archived=FALSE`,
        [req.params.id]
      );
      if (!contact.rowCount) {
        return res.status(404).json({ ok:false, error:"Contacto no encontrado." });
      }
      const [activities,tasks,appointments] = await Promise.all([
        pool.query(
          `SELECT x.*,u.name AS created_by_name
             FROM crm_activities x
             LEFT JOIN crm_users u ON u.id=x.created_by
            WHERE x.contact_id=$1
            ORDER BY x.occurred_at DESC LIMIT 100`,
          [req.params.id]
        ),
        pool.query(
          `SELECT t.*,u.name AS assigned_name
             FROM crm_tasks t
             LEFT JOIN crm_users u ON u.id=t.assigned_user_id
            WHERE t.contact_id=$1
            ORDER BY (t.status='open') DESC,t.due_at`,
          [req.params.id]
        ),
        pool.query(
          `SELECT id,start_time,end_time,status,topic,meet_link,assigned_member_name,source
             FROM appointment_requests
            WHERE crm_contact_id=$1
            ORDER BY start_time DESC NULLS LAST`,
          [req.params.id]
        )
      ]);
      res.json({
        ok:true,
        contact:contact.rows[0],
        activities:activities.rows,
        tasks:tasks.rows,
        appointments:appointments.rows
      });
    } catch (error) {
      console.error("crm_contact_detail_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos cargar el contacto." });
    }
  });

  router.patch("/contacts/:id", auth, async (req, res) => {
    const allowed = {
      name:"name",
      email:"email",
      phone:"phone",
      company:"company",
      title:"title",
      linkedinUrl:"linkedin_url",
      segment:"segment",
      ownerUserId:"owner_user_id",
      sourceChannel:"source_channel",
      sourceProfile:"source_profile",
      sourceDetail:"source_detail",
      sourceContentId:"source_content_id",
      interestPillar:"interest_pillar",
      signal:"signal",
      needSummary:"need_summary",
      notes:"notes",
      nextActionAt:"next_action_at"
    };
    const sets = [];
    const params = [];
    for (const [input,column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, input)) {
        let value = req.body[input];
        if (input === "email") value = cleanNullable(value,200)?.toLowerCase() || null;
        else if (input === "nextActionAt") value = value || null;
        else value = cleanNullable(value, input === "notes" ? 4000 : 1500);
        params.push(value);
        sets.push(column + "=$" + params.length);
      }
    }

    let stageChanged = false;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "stage") && STAGE_SET.has(req.body.stage)) {
      params.push(req.body.stage);
      sets.push("stage=$" + params.length);
      stageChanged = true;
    }

    if (!sets.length) return res.json({ ok:true });
    params.push(req.params.id);

    try {
      const result = await pool.query(
        "UPDATE crm_contacts SET " + sets.join(",") +
        ",updated_at=NOW() WHERE id=$" + params.length +
        " AND archived=FALSE RETURNING id",
        params
      );
      if (!result.rowCount) {
        return res.status(404).json({ ok:false, error:"Contacto no encontrado." });
      }
      if (stageChanged) {
        await pool.query(
          `INSERT INTO crm_activities(id,contact_id,type,direction,summary,created_by,metadata)
           VALUES ($1,$2,'stage_change','internal',$3,$4,$5::jsonb)`,
          [
            crypto.randomUUID(),
            req.params.id,
            "Etapa actualizada a " + req.body.stage,
            req.crmUser.id,
            JSON.stringify({ stage:req.body.stage })
          ]
        );
      }
      await audit(pool, req.crmUser.id, "update", "contact", req.params.id, {
        fields:Object.keys(req.body || {})
      });
      res.json({ ok:true });
    } catch (error) {
      if (String(error.code) === "23505") {
        return res.status(409).json({ ok:false, error:"Ese email ya está asociado a otro contacto." });
      }
      console.error("crm_contact_update_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos actualizar el contacto." });
    }
  });

  router.post("/contacts/:id/archive", auth, async (req, res) => {
    const result = await pool.query(
      "UPDATE crm_contacts SET archived=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ ok:false, error:"Contacto no encontrado." });
    }
    await audit(pool, req.crmUser.id, "archive", "contact", req.params.id);
    res.json({ ok:true });
  });

  router.post("/contacts/:id/activities", auth, async (req, res) => {
    const type = ACTIVITY_TYPES.has(req.body?.type) ? req.body.type : "note";
    const direction = ["inbound","outbound","internal"].includes(req.body?.direction)
      ? req.body.direction
      : "internal";
    const summary = cleanText(req.body?.summary, 2000);
    if (!summary) return res.status(400).json({ ok:false, error:"Escribe un resumen." });

    const id = crypto.randomUUID();
    try {
      await pool.query(
        `INSERT INTO crm_activities(id,contact_id,type,direction,summary,occurred_at,created_by,metadata)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz,NOW()),$7,$8::jsonb)`,
        [
          id,
          req.params.id,
          type,
          direction,
          summary,
          req.body?.occurredAt || null,
          req.crmUser.id,
          JSON.stringify(req.body?.metadata || {})
        ]
      );
      if (type !== "note" && type !== "stage_change") {
        await pool.query(
          "UPDATE crm_contacts SET last_contact_at=NOW(),updated_at=NOW() WHERE id=$1",
          [req.params.id]
        );
      }
      res.status(201).json({ ok:true, id });
    } catch (error) {
      console.error("crm_activity_create_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos registrar la actividad." });
    }
  });

  router.get("/tasks", auth, async (req, res) => {
    const scope = cleanText(req.query.scope || "open", 30);
    const params = [];
    const where = [];
    if (scope !== "all") where.push("t.status='open'");
    if (scope === "today") where.push("t.due_at<NOW()+INTERVAL '1 day'");
    if (scope === "overdue") where.push("t.due_at<NOW()");
    if (req.query.mine === "1") {
      params.push(req.crmUser.id);
      where.push("t.assigned_user_id=$" + params.length);
    }
    const result = await pool.query(
      `SELECT t.*,c.name AS contact_name,c.company,c.linkedin_url,c.stage,u.name AS assigned_name
         FROM crm_tasks t
         LEFT JOIN crm_contacts c ON c.id=t.contact_id
         LEFT JOIN crm_users u ON u.id=t.assigned_user_id ` +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY (t.status='open') DESC,t.due_at ASC LIMIT 300",
      params
    );
    res.json({ ok:true, tasks:result.rows });
  });

  router.post("/tasks", auth, async (req, res) => {
    const type = TASK_TYPES.has(req.body?.type) ? req.body.type : "custom";
    const title = cleanText(req.body?.title, 240);
    const dueAt = req.body?.dueAt;
    if (!title || !dueAt) {
      return res.status(400).json({ ok:false, error:"Título y fecha son obligatorios." });
    }
    const id = crypto.randomUUID();
    const assigned = cleanNullable(req.body?.assignedUserId,60) || req.crmUser.id;
    try {
      await pool.query(
        `INSERT INTO crm_tasks(id,contact_id,type,title,notes,due_at,priority,assigned_user_id,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          cleanNullable(req.body?.contactId,60),
          type,
          title,
          cleanNullable(req.body?.notes,1500),
          dueAt,
          ["low","normal","high"].includes(req.body?.priority) ? req.body.priority : "normal",
          assigned,
          req.crmUser.id
        ]
      );
      if (req.body?.contactId) {
        await pool.query(
          `UPDATE crm_contacts
                SET next_action_at=CASE
                      WHEN next_action_at IS NULL OR next_action_at>$2 THEN $2
                      ELSE next_action_at
                    END,
                    updated_at=NOW()
              WHERE id=$1`,
          [req.body.contactId,dueAt]
        );
      }
      res.status(201).json({ ok:true, id });
    } catch (error) {
      console.error("crm_task_create_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos crear la tarea." });
    }
  });

  router.patch("/tasks/:id", auth, async (req, res) => {
    const status = ["open","done","cancelled"].includes(req.body?.status)
      ? req.body.status
      : null;
    if (!status) return res.status(400).json({ ok:false, error:"Estado inválido." });
    const result = await pool.query(
      `UPDATE crm_tasks
            SET status=$2,
                completed_at=CASE WHEN $2='done' THEN NOW() ELSE NULL END,
                updated_at=NOW()
          WHERE id=$1
          RETURNING contact_id`,
      [req.params.id,status]
    );
    if (!result.rowCount) return res.status(404).json({ ok:false, error:"Tarea no encontrada." });
    res.json({ ok:true });
  });

  router.get("/linkedin/today", auth, async (_req, res) => {
    try {
      const tasks = await pool.query(
        `SELECT t.*,c.name AS contact_name,c.company,c.title AS contact_title,
                  c.linkedin_url,c.stage,c.signal,u.name AS assigned_name
             FROM crm_tasks t
             JOIN crm_contacts c ON c.id=t.contact_id
             LEFT JOIN crm_users u ON u.id=t.assigned_user_id
            WHERE t.status='open'
              AND t.type IN ('linkedin_comment','linkedin_connect','linkedin_dm','linkedin_followup')
              AND t.due_at<NOW()+INTERVAL '1 day'
            ORDER BY t.due_at ASC
            LIMIT 50`
      );
      const prospects = await pool.query(
        `SELECT c.*,u.name AS owner_name
             FROM crm_contacts c
             LEFT JOIN crm_users u ON u.id=c.owner_user_id
            WHERE c.archived=FALSE
              AND c.source_channel='linkedin'
              AND c.stage IN ('target','engaged','connected','conversation','need_identified')
              AND NOT EXISTS (
                SELECT 1 FROM crm_tasks t
                 WHERE t.contact_id=c.id
                   AND t.status='open'
                   AND t.type IN ('linkedin_comment','linkedin_connect','linkedin_dm','linkedin_followup')
              )
            ORDER BY COALESCE(c.next_action_at,c.updated_at) ASC
            LIMIT 15`
      );
      res.json({ ok:true, tasks:tasks.rows, prospects:prospects.rows });
    } catch (error) {
      console.error("crm_linkedin_today_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos cargar la prospección." });
    }
  });

  router.get("/content", auth, async (_req, res) => {
    const result = await pool.query(
      `SELECT a.*,
              COUNT(c.id)::int AS contacts,
              COUNT(c.id) FILTER (
                WHERE c.stage IN ('booked','showed','diagnostic','proposal','won')
              )::int AS meetings_or_beyond
         FROM crm_content_assets a
         LEFT JOIN crm_contacts c ON c.source_content_id=a.id AND c.archived=FALSE
        GROUP BY a.id
        ORDER BY COALESCE(a.published_at,a.created_at) DESC`
    );
    res.json({ ok:true, content:result.rows });
  });

  router.post("/content", auth, async (req, res) => {
    const title = cleanText(req.body?.title, 240);
    const profile = cleanText(req.body?.profile, 100);
    if (!title || !profile) {
      return res.status(400).json({ ok:false, error:"Título y perfil son obligatorios." });
    }
    const id = crypto.randomUUID();
    const trackingCode = cleanText(req.body?.trackingCode,80) ||
      ("li-" + crypto.randomBytes(5).toString("hex"));
    try {
      await pool.query(
        `INSERT INTO crm_content_assets(
          id,platform,profile,title,url,published_at,topic,pillar,cta,status,tracking_code,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          cleanText(req.body?.platform || "linkedin",40),
          profile,
          title,
          cleanNullable(req.body?.url,800),
          req.body?.publishedAt || null,
          cleanNullable(req.body?.topic,180),
          cleanNullable(req.body?.pillar,80),
          cleanNullable(req.body?.cta,300),
          cleanText(req.body?.status || "draft",30),
          trackingCode,
          req.crmUser.id
        ]
      );
      res.status(201).json({ ok:true, id, trackingCode });
    } catch (error) {
      if (String(error.code) === "23505") {
        return res.status(409).json({ ok:false, error:"Ese código de tracking ya existe." });
      }
      console.error("crm_content_create_failed", error);
      res.status(500).json({ ok:false, error:"No pudimos crear el contenido." });
    }
  });

  router.patch("/content/:id", auth, async (req, res) => {
    const allowed = {
      platform:"platform",
      profile:"profile",
      title:"title",
      url:"url",
      publishedAt:"published_at",
      topic:"topic",
      pillar:"pillar",
      cta:"cta",
      status:"status"
    };
    const sets = [];
    const params = [];
    for (const [input,column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(req.body || {},input)) {
        let value = req.body[input];
        if (input === "publishedAt") value = value || null;
        else value = cleanNullable(value,input === "url" ? 800 : 300);
        params.push(value);
        sets.push(column + "=$" + params.length);
      }
    }
    if (!sets.length) return res.json({ ok:true });
    params.push(req.params.id);
    const result = await pool.query(
      "UPDATE crm_content_assets SET " + sets.join(",") +
      ",updated_at=NOW() WHERE id=$" + params.length + " RETURNING id",
      params
    );
    if (!result.rowCount) {
      return res.status(404).json({ ok:false, error:"Contenido no encontrado." });
    }
    res.json({ ok:true });
  });

  return router;
}
