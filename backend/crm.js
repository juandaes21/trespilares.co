import express from "express";
import crypto from "node:crypto";
import { crmAuth, crmAdmin, crmWriteAccess, authServiceRequest, authServiceUrl, setCrmAccessCookie, clearCrmAccessCookie } from "./auth-client.js";

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

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    teamMemberEmail: row.team_member_email || null,
    avatarUrl: row.avatar_url || null,
    lastLoginAt: row.last_login_at || null,
    active: row.active !== false
  };
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
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      team_member_email TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );


    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS google_sub TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS team_member_email TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

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
      target_score SMALLINT,
      score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
      score_reason TEXT,
      score_version TEXT,
      scored_at TIMESTAMPTZ,
      last_contact_at TIMESTAMPTZ,
      next_action_at TIMESTAMPTZ,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_by UUID REFERENCES crm_users(id)
    );
    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS target_score SMALLINT;
    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS score_reason TEXT;
    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS score_version TEXT;
    ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS crm_contacts_score_idx ON crm_contacts(target_score DESC) WHERE archived = FALSE;
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

export async function importCrmTargetsFromEnv(pool) {
  if (!pool) return { imported:0, updated:0, tasks:0 };
  const raw = String(process.env.CRM_TARGET_IMPORT_JSON || "").trim();
  if (!raw || raw === "[]") return { imported:0, updated:0, tasks:0 };

  let targets;
  try {
    targets = JSON.parse(raw);
  } catch (error) {
    console.error("crm_target_import_invalid_json", error);
    return { imported:0, updated:0, tasks:0 };
  }
  if (!Array.isArray(targets)) return { imported:0, updated:0, tasks:0 };
  targets = targets.slice(0, 100);

  let imported = 0;
  let updated = 0;
  let tasks = 0;

  for (const target of targets) {
    const contactIdInput = cleanText(target?.contactId, 80);
    const name = cleanText(target?.name, 160);
    const linkedinUrl = cleanText(target?.linkedinUrl, 500);
    if (!contactIdInput && (!name || !linkedinUrl)) continue;

    const ownerEmail = normalizeEmail(target?.ownerEmail || "");
    const ownerName = cleanText(target?.ownerName || "", 160);
    let ownerId = null;
    if (ownerEmail) {
      const owner = await pool.query(
        "SELECT id FROM crm_users WHERE LOWER(email)=LOWER($1) AND active=TRUE LIMIT 1",
        [ownerEmail]
      );
      ownerId = owner.rows[0]?.id || null;
    }
    if (!ownerId && ownerName) {
      const owner = await pool.query(
        "SELECT id FROM crm_users WHERE active=TRUE AND name ILIKE $1 ORDER BY updated_at DESC LIMIT 1",
        ["%" + ownerName + "%"]
      );
      ownerId = owner.rows[0]?.id || null;
    }

    const requestedStage = STAGE_SET.has(target?.stage) ? target.stage : "target";

    const score = Number.isFinite(Number(target?.targetScore))
      ? Math.max(0, Math.min(100, Math.round(Number(target.targetScore))))
      : null;
    const breakdown = target?.scoreBreakdown && typeof target.scoreBreakdown === "object"
      ? target.scoreBreakdown
      : {};
    const scoreReason = cleanNullable(target?.scoreReason, 2000);
    const scoreVersion = cleanNullable(target?.scoreVersion || "TP-LI-v1", 80);

    const existing = contactIdInput
      ? await pool.query(
          "SELECT id FROM crm_contacts WHERE id::text=$1 AND archived=FALSE LIMIT 1",
          [contactIdInput]
        )
      : await pool.query(
          "SELECT id FROM crm_contacts WHERE linkedin_url=$1 AND archived=FALSE LIMIT 1",
          [linkedinUrl]
        );

    let contactId;
    if (existing.rowCount) {
      contactId = existing.rows[0].id;
      await pool.query(
        `UPDATE crm_contacts
            SET company=COALESCE(NULLIF($2,''),company),
                title=COALESCE(NULLIF($3,''),title),
                segment=COALESCE(NULLIF($4,''),segment),
                owner_user_id=COALESCE(owner_user_id,$5),
                source_channel='linkedin',
                source_profile=COALESCE(NULLIF($6,''),source_profile),
                source_detail=COALESCE(NULLIF($7,''),source_detail),
                stage=CASE
                  WHEN array_position($8::text[], stage) IS NULL THEN $9
                  WHEN array_position($8::text[], $9) > array_position($8::text[], stage) THEN $9
                  ELSE stage
                END,
                signal=COALESCE(NULLIF($10,''),signal),
                notes=COALESCE(NULLIF($11,''),notes),
                target_score=$12,
                score_breakdown=$13::jsonb,
                score_reason=$14,
                score_version=$15,
                scored_at=NOW(),
                updated_at=NOW()
          WHERE id=$1`,
        [
          contactId,
          cleanText(target?.company,160),
          cleanText(target?.title,160),
          cleanText(target?.segment,100),
          ownerId,
          cleanText(target?.sourceProfile || "Juan David",100),
          cleanText(target?.sourceDetail || "prospecting-score",180),
          CRM_STAGES,
          requestedStage,
          cleanText(target?.signal,500),
          cleanText(target?.notes,4000),
          score,
          JSON.stringify(breakdown),
          scoreReason,
          scoreVersion
        ]
      );
      updated += 1;
    } else {
      if (contactIdInput) continue;
      contactId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_contacts(
          id,name,company,title,linkedin_url,segment,owner_user_id,source_channel,source_profile,
          source_detail,stage,signal,notes,target_score,score_breakdown,score_reason,score_version,scored_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'linkedin',$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,NOW())`,
        [
          contactId,
          name,
          cleanNullable(target?.company,160),
          cleanNullable(target?.title,160),
          linkedinUrl,
          cleanNullable(target?.segment,100),
          ownerId,
          cleanText(target?.sourceProfile || "Juan David",100),
          cleanNullable(target?.sourceDetail || "prospecting-score",180),
          requestedStage,
          cleanNullable(target?.signal,500),
          cleanNullable(target?.notes,4000),
          score,
          JSON.stringify(breakdown),
          scoreReason,
          scoreVersion
        ]
      );
      await pool.query(
        `INSERT INTO crm_activities(id,contact_id,type,direction,summary,metadata,created_by)
         VALUES ($1,$2,'note','internal',$3,$4::jsonb,$5)`,
        [
          crypto.randomUUID(),
          contactId,
          "Target incorporado por scoring de prospección",
          JSON.stringify({ targetScore:score, scoreVersion }),
          ownerId
        ]
      );
      imported += 1;
    }

    const completeTasks = Array.isArray(target?.completeTasks) ? target.completeTasks.slice(0, 20) : [];
    for (const taskToComplete of completeTasks) {
      const taskType = cleanText(taskToComplete?.type, 80);
      const taskTitle = cleanText(taskToComplete?.title, 240);
      if (!taskType && !taskTitle) continue;
      const params = [contactId];
      const filters = ["contact_id=$1", "status='open'"];
      if (taskType) {
        params.push(taskType);
        filters.push("type=$" + params.length);
      }
      if (taskTitle) {
        params.push(taskTitle);
        filters.push("title=$" + params.length);
      }
      const openTasks = await pool.query(
        "SELECT id FROM crm_tasks WHERE " + filters.join(" AND ") + " LIMIT 20",
        params
      );
      for (const row of openTasks.rows) {
        await pool.query(
          "UPDATE crm_tasks SET status='done',completed_at=NOW(),updated_at=NOW() WHERE id=$1",
          [row.id]
        );
      }
    }

    const activity = target?.activity;
    if (activity?.summary) {
      const activityType = ACTIVITY_TYPES.has(activity.type) ? activity.type : "note";
      const direction = ["inbound","outbound","internal"].includes(activity.direction)
        ? activity.direction
        : "internal";
      const summary = cleanText(activity.summary, 2000);
      const existsActivity = await pool.query(
        `SELECT id FROM crm_activities
          WHERE contact_id=$1 AND type=$2 AND direction=$3 AND summary=$4
          LIMIT 1`,
        [contactId, activityType, direction, summary]
      );
      if (!existsActivity.rowCount) {
        await pool.query(
          `INSERT INTO crm_activities(id,contact_id,type,direction,summary,occurred_at,created_by,metadata)
           VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz,NOW()),$7,$8::jsonb)`,
          [
            crypto.randomUUID(),
            contactId,
            activityType,
            direction,
            summary,
            activity.occurredAt || null,
            ownerId,
            JSON.stringify(activity.metadata && typeof activity.metadata === "object" ? activity.metadata : {})
          ]
        );
        if (activityType !== "note" && activityType !== "stage_change") {
          await pool.query(
            "UPDATE crm_contacts SET last_contact_at=NOW(),updated_at=NOW() WHERE id=$1",
            [contactId]
          );
        }
      }
    }

    const task = target?.task;
    if (task?.title && task?.type && TASK_TYPES.has(task.type)) {
      const existsTask = await pool.query(
        `SELECT id FROM crm_tasks
          WHERE contact_id=$1 AND status='open' AND type=$2 AND title=$3
          LIMIT 1`,
        [contactId, task.type, cleanText(task.title,240)]
      );
      if (!existsTask.rowCount) {
        const dueAt = task.dueAt || new Date(Date.now() + 24*60*60*1000).toISOString();
        await pool.query(
          `INSERT INTO crm_tasks(id,contact_id,type,title,notes,due_at,priority,assigned_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            crypto.randomUUID(),
            contactId,
            task.type,
            cleanText(task.title,240),
            cleanNullable(task.notes,1500),
            dueAt,
            ["low","normal","high"].includes(task.priority) ? task.priority : "normal",
            ownerId
          ]
        );
        await pool.query(
          `UPDATE crm_contacts
              SET next_action_at=CASE WHEN next_action_at IS NULL OR next_action_at>$2 THEN $2 ELSE next_action_at END
            WHERE id=$1`,
          [contactId,dueAt]
        );
        tasks += 1;
      }
    }
  }

  console.log("crm_target_import_complete", { imported, updated, tasks });
  return { imported, updated, tasks };
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

  const auth = crmAuth(pool);
  const admin = crmAdmin;
  const writeAccess = crmWriteAccess;

  router.get("/auth/google", (_req, res) => {
    try {
      res.redirect(authServiceUrl("/auth/google"));
    } catch {
      res.status(503).send("El servicio de autenticación no está configurado.");
    }
  });

  router.get("/auth/complete", async (req, res) => {
    const code = cleanText(req.query.code, 500);
    const authError = cleanText(req.query.auth, 80);
    if (authError) return res.redirect("/crm/?auth=" + encodeURIComponent(authError));
    if (!code) return res.redirect("/crm/?auth=missing_code");

    try {
      const result = await authServiceRequest("/internal/exchange", {
        method:"POST",
        body:{ code }
      });
      setCrmAccessCookie(res, result.accessToken, Number(result.expiresIn || 43200));
      res.redirect("/crm/");
    } catch (error) {
      console.error("crm_auth_exchange_failed", error);
      res.redirect("/crm/?auth=failed");
    }
  });

  router.post("/auth/logout", (_req, res) => {
    clearCrmAccessCookie(res);
    res.json({ ok:true });
  });

  router.get("/auth/logout", (_req, res) => {
    clearCrmAccessCookie(res);
    res.redirect("/crm/");
  });

  router.get("/me", auth, (req, res) => {
    res.json({ ok:true, user:publicUser(req.crmUser) });
  });

  router.get("/users", auth, async (_req, res) => {
    const result = await pool.query(
      "SELECT id,name,email,role,team_member_email,avatar_url,active,last_login_at FROM crm_users ORDER BY active DESC,name"
    );
    res.json({ ok:true, users:result.rows.map(publicUser) });
  });

  router.post("/users", auth, admin, async (req, res) => {
    const name = cleanText(req.body?.name, 120);
    const email = normalizeEmail(req.body?.email);
    const role = ["admin","member","viewer"].includes(req.body?.role) ? req.body.role : "member";
    const teamMemberEmail = normalizeEmail(req.body?.teamMemberEmail || email);

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok:false, error:"Completa nombre y email." });
    }

    try {
      const result = await authServiceRequest("/internal/users", {
        method:"POST",
        body:{ name,email,role,teamMemberEmail }
      });
      await audit(pool, req.crmUser.id, "create", "user", result.id, { email,role });
      res.status(201).json(result);
    } catch (error) {
      res.status(error.status || 500).json({
        ok:false,
        error:error.message || "No pudimos crear el usuario."
      });
    }
  });

  router.patch("/users/:id", auth, admin, async (req, res) => {
    const body = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "active")) {
      body.active = Boolean(req.body.active);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "role")) {
      if (!["admin","member","viewer"].includes(req.body.role)) {
        return res.status(400).json({ ok:false, error:"Rol inválido." });
      }
      body.role = req.body.role;
    }

    if (!Object.keys(body).length) {
      return res.status(400).json({ ok:false, error:"No hay cambios para aplicar." });
    }

    if (req.params.id === req.crmUser.id && body.active === false) {
      return res.status(400).json({
        ok:false,
        error:"No puedes quitar tu propio acceso mientras estás usando esa cuenta."
      });
    }

    try {
      const result = await authServiceRequest("/internal/users/" + encodeURIComponent(req.params.id), {
        method:"PATCH",
        body
      });
      await audit(
        pool,
        req.crmUser.id,
        body.active === false ? "deactivate" : body.active === true ? "reactivate" : "update",
        "user",
        req.params.id,
        body
      );
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({
        ok:false,
        error:error.message || "No pudimos actualizar el acceso."
      });
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

  router.post("/contacts", auth, writeAccess, async (req, res) => {
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
          notes,target_score,score_breakdown,score_reason,score_version,scored_at,next_action_at,created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25,$26)`,
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
          Number.isFinite(Number(body.targetScore)) ? Math.max(0,Math.min(100,Math.round(Number(body.targetScore)))) : null,
          JSON.stringify(body.scoreBreakdown && typeof body.scoreBreakdown === "object" ? body.scoreBreakdown : {}),
          cleanNullable(body.scoreReason,2000),
          cleanNullable(body.scoreVersion,80),
          body.targetScore != null ? new Date().toISOString() : null,
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

  router.patch("/contacts/:id", auth, writeAccess, async (req, res) => {
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
      scoreReason:"score_reason",
      scoreVersion:"score_version",
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

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "targetScore")) {
      const score = Number(req.body.targetScore);
      params.push(Number.isFinite(score) ? Math.max(0,Math.min(100,Math.round(score))) : null);
      sets.push("target_score=$" + params.length);
      sets.push("scored_at=NOW()");
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "scoreBreakdown")) {
      params.push(JSON.stringify(req.body.scoreBreakdown && typeof req.body.scoreBreakdown === "object" ? req.body.scoreBreakdown : {}));
      sets.push("score_breakdown=$" + params.length + "::jsonb");
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

  router.post("/contacts/:id/archive", auth, writeAccess, async (req, res) => {
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

  router.post("/contacts/:id/activities", auth, writeAccess, async (req, res) => {
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

  router.post("/tasks", auth, writeAccess, async (req, res) => {
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

  router.patch("/tasks/:id", auth, writeAccess, async (req, res) => {
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
            ORDER BY c.target_score DESC NULLS LAST, COALESCE(c.next_action_at,c.updated_at) ASC
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

  router.post("/content", auth, writeAccess, async (req, res) => {
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

  router.patch("/content/:id", auth, writeAccess, async (req, res) => {
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
