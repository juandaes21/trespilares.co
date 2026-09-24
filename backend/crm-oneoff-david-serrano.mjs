import crypto from "node:crypto";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const db = await pool.connect();
try {
  await db.query("BEGIN");

  const ownerRes = await db.query(
    `SELECT id, name
       FROM crm_users
      WHERE active = TRUE
        AND name ILIKE $1
      ORDER BY (team_member_email IS NOT NULL) DESC, updated_at DESC
      LIMIT 1`,
    ["%Juan David%"]
  );
  if (!ownerRes.rowCount) throw new Error("No se encontró un usuario activo de Juan David");
  const owner = ownerRes.rows[0];

  const existingRes = await db.query(
    `SELECT id, stage
       FROM crm_contacts
      WHERE LOWER(name) = LOWER($1)
        AND archived = FALSE
      ORDER BY created_at DESC
      LIMIT 1`,
    ["David Serrano"]
  );

  let contactId;
  let created = false;

  if (existingRes.rowCount) {
    contactId = existingRes.rows[0].id;
    await db.query(
      `UPDATE crm_contacts
          SET stage = CASE WHEN stage IN ('target','engaged') THEN 'connected' ELSE stage END,
              owner_user_id = COALESCE(owner_user_id, $2),
              source_channel = CASE WHEN source_channel IS NULL OR source_channel = 'manual' THEN 'linkedin' ELSE source_channel END,
              source_profile = COALESCE(source_profile, 'Juan David'),
              source_detail = COALESCE(source_detail, 'Conexión aceptada'),
              signal = COALESCE(signal, $3),
              notes = CASE
                WHEN notes IS NULL OR notes = '' THEN $4
                WHEN POSITION($4 IN notes) = 0 THEN notes || E'\\n' || $4
                ELSE notes
              END,
              last_contact_at = NOW(),
              next_action_at = CASE WHEN next_action_at IS NULL OR next_action_at > NOW() THEN NOW() ELSE next_action_at END,
              updated_at = NOW()
        WHERE id = $1`,
      [
        contactId,
        owner.id,
        "Aceptó la invitación de contacto en LinkedIn",
        "Aceptó la invitación de contacto en LinkedIn el 24 de septiembre de 2026."
      ]
    );
  } else {
    contactId = crypto.randomUUID();
    created = true;
    await db.query(
      `INSERT INTO crm_contacts (
          id, name, owner_user_id, source_channel, source_profile, source_detail,
          stage, signal, notes, last_contact_at, next_action_at, created_by
        ) VALUES (
          $1, $2, $3, 'linkedin', 'Juan David', 'Conexión aceptada',
          'connected', $4, $5, NOW(), NOW(), $3
        )`,
      [
        contactId,
        "David Serrano",
        owner.id,
        "Aceptó la invitación de contacto en LinkedIn",
        "Aceptó la invitación de contacto en LinkedIn el 24 de septiembre de 2026."
      ]
    );
  }

  let activityId;
  const activityRes = await db.query(
    `SELECT id
       FROM crm_activities
      WHERE contact_id = $1
        AND type = 'linkedin_connection'
        AND summary = $2
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [contactId, "Aceptó la invitación de contacto en LinkedIn"]
  );
  if (activityRes.rowCount) {
    activityId = activityRes.rows[0].id;
  } else {
    activityId = crypto.randomUUID();
    await db.query(
      `INSERT INTO crm_activities (
          id, contact_id, type, direction, summary, occurred_at, created_by
        ) VALUES (
          $1, $2, 'linkedin_connection', 'inbound', $3, NOW(), $4
        )`,
      [activityId, contactId, "Aceptó la invitación de contacto en LinkedIn", owner.id]
    );
  }

  let taskId;
  const taskRes = await db.query(
    `SELECT id
       FROM crm_tasks
      WHERE contact_id = $1
        AND type = 'linkedin_dm'
        AND status = 'open'
        AND title = $2
      ORDER BY due_at ASC
      LIMIT 1`,
    [contactId, "Enviar mensaje inicial por LinkedIn"]
  );
  if (taskRes.rowCount) {
    taskId = taskRes.rows[0].id;
  } else {
    taskId = crypto.randomUUID();
    await db.query(
      `INSERT INTO crm_tasks (
          id, contact_id, type, title, due_at, status, priority, assigned_user_id, created_by
        ) VALUES (
          $1, $2, 'linkedin_dm', $3, NOW(), 'open', 'normal', $4, $4
        )`,
      [taskId, contactId, "Enviar mensaje inicial por LinkedIn", owner.id]
    );
  }

  await db.query("COMMIT");

  const verify = await db.query(
    `SELECT c.id, c.name, c.stage, c.source_channel, c.source_profile,
            u.name AS owner_name,
            EXISTS (
              SELECT 1 FROM crm_activities a
              WHERE a.contact_id = c.id AND a.type = 'linkedin_connection'
            ) AS activity_ok,
            EXISTS (
              SELECT 1 FROM crm_tasks t
              WHERE t.contact_id = c.id AND t.type = 'linkedin_dm' AND t.status = 'open'
            ) AS task_ok
       FROM crm_contacts c
       LEFT JOIN crm_users u ON u.id = c.owner_user_id
      WHERE c.id = $1`,
    [contactId]
  );

  console.log("CRM_INSERT_RESULT " + JSON.stringify({
    created,
    contactId,
    activityId,
    taskId,
    ownerId: owner.id,
    ownerName: owner.name,
    verify: verify.rows[0]
  }));
} catch (error) {
  try { await db.query("ROLLBACK"); } catch {}
  console.error("CRM_INSERT_ERROR " + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}
