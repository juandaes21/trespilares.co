import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";
import { google } from "googleapis";
import { DateTime, Interval } from "luxon";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);

const TIMEZONE = process.env.CALENDAR_TIMEZONE || "America/Bogota";
const GOOGLE_ACCOUNT_EMAIL = process.env.GOOGLE_ACCOUNT_EMAIL || "trespilares.co@gmail.com";
const BOOKING_CALENDAR_ID = process.env.BOOKING_CALENDAR_ID || GOOGLE_ACCOUNT_EMAIL;
const TEAM_MEMBERS = (process.env.TEAM_MEMBERS || `Tres Pilares|${GOOGLE_ACCOUNT_EMAIL}`)
  .split(",")
  .map((entry) => {
    const [name, email] = entry.split("|").map((v) => String(v || "").trim());
    return { name: name || email, email: String(email || "").toLowerCase() };
  })
  .filter((member) => member.email);
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  "https://tres-pilares-api-production.up.railway.app/api/google/callback";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://trespilares.co";
const WORKDAY_START = process.env.WORKDAY_START || "09:00";
const WORKDAY_END = process.env.WORKDAY_END || "17:00";
const DURATION_MIN = Number(process.env.APPOINTMENT_DURATION_MINUTES || 30);
const SLOT_MIN = Number(process.env.SLOT_INTERVAL_MINUTES || 30);
const MIN_NOTICE_HOURS = Number(process.env.MIN_NOTICE_HOURS || 2);
const MAX_BOOKING_DAYS = Number(process.env.MAX_BOOKING_DAYS || 30);
const WORKING_DAYS = new Set(
  (process.env.WORKING_DAYS || "1,2,3,4,5")
    .split(",")
    .map(Number)
    .filter((n) => n >= 1 && n <= 7)
);

const allowedOrigins = (process.env.FRONTEND_ORIGINS ||
  "https://trespilares.co,https://www.trespilares.co")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
    })
  : null;

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT NOT NULL,
      topic TEXT NOT NULL,
      preferred_date DATE,
      preferred_time TEXT,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      calendar_event_id TEXT,
      meet_link TEXT,
      source TEXT NOT NULL DEFAULT 'website',
      status TEXT NOT NULL DEFAULT 'new'
    );

    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS meet_link TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS assigned_member_name TEXT;
    ALTER TABLE appointment_requests ADD COLUMN IF NOT EXISTS assigned_member_email TEXT;

    DROP INDEX IF EXISTS appointment_requests_active_start_idx;
    CREATE INDEX IF NOT EXISTS appointment_requests_member_time_idx
      ON appointment_requests(assigned_member_email, start_time, end_time)
      WHERE start_time IS NOT NULL AND status <> 'cancelled';

    CREATE TABLE IF NOT EXISTS team_assignment_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      last_member_email TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    INSERT INTO team_assignment_state(id, last_member_email)
    VALUES (1, NULL)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      account_email TEXT PRIMARY KEY,
      encrypted_refresh_token TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function keyBuffer() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(raw)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex chars");
  }
  return Buffer.from(raw, "hex");
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

function decryptSecret(value) {
  const [ivB64, tagB64, dataB64] = String(value).split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyBuffer(),
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function oauthClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are not configured");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function signState() {
  const payload = Buffer.from(JSON.stringify({
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex")
  })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", keyBuffer())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifyState(state) {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return false;
  const expected = crypto
    .createHmac("sha256", keyBuffer())
    .update(payload)
    .digest("base64url");
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Date.now() - Number(parsed.ts) < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

async function saveRefreshToken(refreshToken) {
  await pool.query(
    `INSERT INTO google_oauth_tokens(account_email, encrypted_refresh_token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (account_email)
     DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, updated_at = NOW()`,
    [GOOGLE_ACCOUNT_EMAIL, encryptSecret(refreshToken)]
  );
}

async function loadRefreshToken() {
  if (!pool) return null;
  const result = await pool.query(
    "SELECT encrypted_refresh_token FROM google_oauth_tokens WHERE account_email = $1",
    [GOOGLE_ACCOUNT_EMAIL]
  );
  if (!result.rowCount) return null;
  return decryptSecret(result.rows[0].encrypted_refresh_token);
}

async function calendarClient() {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) return null;
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
}

function parseClock(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Invalid clock config");
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function dayWindow(date) {
  const day = DateTime.fromISO(date, { zone: TIMEZONE });
  if (!day.isValid) return null;
  const s = parseClock(WORKDAY_START);
  const e = parseClock(WORKDAY_END);
  return {
    day,
    start: day.set({ ...s, second: 0, millisecond: 0 }),
    end: day.set({ ...e, second: 0, millisecond: 0 })
  };
}

function validateDate(date) {
  const w = dayWindow(date);
  if (!w) return { ok: false, error: "Fecha inválida." };
  if (!WORKING_DAYS.has(w.day.weekday)) {
    return { ok: false, error: "No tenemos agenda disponible ese día." };
  }
  const now = DateTime.now().setZone(TIMEZONE);
  if (w.day.endOf("day") < now.startOf("day")) {
    return { ok: false, error: "La fecha seleccionada ya pasó." };
  }
  if (w.day.startOf("day") > now.plus({ days: MAX_BOOKING_DAYS }).endOf("day")) {
    return { ok: false, error: "La fecha está fuera de la ventana de agendamiento." };
  }
  return { ok: true, ...w };
}

async function googleBusyByMember(start, end) {
  const calendar = await calendarClient();
  if (!calendar) throw new Error("calendar_not_connected");

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toUTC().toISO(),
      timeMax: end.toUTC().toISO(),
      timeZone: TIMEZONE,
      items: TEAM_MEMBERS.map((member) => ({ id: member.email }))
    }
  });

  const result = new Map();
  for (const member of TEAM_MEMBERS) {
    const data = response.data.calendars?.[member.email];
    if (data?.errors?.length) {
      console.warn("calendar_access_failed", member.email, data.errors);
      result.set(member.email, null);
      continue;
    }
    result.set(
      member.email,
      (data?.busy || []).map((b) =>
        Interval.fromDateTimes(
          DateTime.fromISO(b.start, { setZone: true }),
          DateTime.fromISO(b.end, { setZone: true })
        )
      )
    );
  }
  return result;
}

async function dbBusyByMember(start, end) {
  const result = await pool.query(
    `SELECT assigned_member_email, start_time, end_time
       FROM appointment_requests
      WHERE status <> 'cancelled'
        AND start_time IS NOT NULL
        AND end_time IS NOT NULL
        AND start_time < $2
        AND end_time > $1`,
    [start.toUTC().toISO(), end.toUTC().toISO()]
  );

  const byMember = new Map(TEAM_MEMBERS.map((member) => [member.email, []]));
  const legacyGlobal = [];

  for (const row of result.rows) {
    const interval = Interval.fromDateTimes(
      DateTime.fromJSDate(row.start_time, { zone: "utc" }),
      DateTime.fromJSDate(row.end_time, { zone: "utc" })
    );
    const email = String(row.assigned_member_email || "").toLowerCase();
    if (email && byMember.has(email)) byMember.get(email).push(interval);
    else legacyGlobal.push(interval);
  }

  return { byMember, legacyGlobal };
}

function overlaps(slot, busy) {
  return busy.some((b) => b.overlaps(slot));
}

async function getAvailableMembersForSlot(slot, googleBusy, dbBusy) {
  return TEAM_MEMBERS.filter((member) => {
    const googleIntervals = googleBusy.get(member.email);
    if (googleIntervals === null) return false;
    const dbIntervals = dbBusy.byMember.get(member.email) || [];
    return !overlaps(slot, googleIntervals || []) &&
      !overlaps(slot, dbIntervals) &&
      !overlaps(slot, dbBusy.legacyGlobal);
  });
}

async function getAvailability(date) {
  const valid = validateDate(date);
  if (!valid.ok) return valid;

  const { start, end } = valid;
  const [googleBusy, dbBusy] = await Promise.all([
    googleBusyByMember(start, end),
    dbBusyByMember(start, end)
  ]);
  const earliest = DateTime.now().setZone(TIMEZONE).plus({ hours: MIN_NOTICE_HOURS });

  const slots = [];
  for (
    let cursor = start;
    cursor.plus({ minutes: DURATION_MIN }) <= end;
    cursor = cursor.plus({ minutes: SLOT_MIN })
  ) {
    const slotEnd = cursor.plus({ minutes: DURATION_MIN });
    const slot = Interval.fromDateTimes(cursor, slotEnd);
    if (cursor < earliest) continue;

    const availableMembers = await getAvailableMembersForSlot(slot, googleBusy, dbBusy);
    if (availableMembers.length) {
      slots.push({
        start: cursor.toISO(),
        end: slotEnd.toISO(),
        label: cursor.setLocale("es").toFormat("h:mm a"),
        availableCount: availableMembers.length
      });
    }
  }

  return {
    ok: true,
    date,
    timezone: TIMEZONE,
    durationMinutes: DURATION_MIN,
    slots
  };
}

async function chooseRoundRobinMember(client, availableMembers) {
  const state = await client.query(
    "SELECT last_member_email FROM team_assignment_state WHERE id = 1 FOR UPDATE"
  );
  const last = String(state.rows[0]?.last_member_email || "").toLowerCase();
  const ordered = TEAM_MEMBERS;
  const startIndex = Math.max(0, ordered.findIndex((m) => m.email === last) + 1);

  let chosen = null;
  for (let i = 0; i < ordered.length; i += 1) {
    const candidate = ordered[(startIndex + i) % ordered.length];
    if (availableMembers.some((m) => m.email === candidate.email)) {
      chosen = candidate;
      break;
    }
  }
  chosen ||= availableMembers[0];

  await client.query(
    "UPDATE team_assignment_state SET last_member_email = $1, updated_at = NOW() WHERE id = 1",
    [chosen.email]
  );
  return chosen;
}

async function createCalendarEvent({ name, email, phone, topic, start, end, assignedMember }) {
  const calendar = await calendarClient();
  if (!calendar) throw new Error("calendar_not_connected");

  const response = await calendar.events.insert({
    calendarId: BOOKING_CALENDAR_ID,
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: `Sesión Tres Pilares · ${name}`,
      description: [
        "Sesión inicial de planificación patrimonial.",
        "",
        `Cliente: ${name}`,
        `Email: ${email}`,
        `WhatsApp: ${phone}`,
        `Tema: ${topic}`,
        `Profesional asignado: ${assignedMember.name} (${assignedMember.email})`,
        "Origen: trespilares.co"
      ].join("\n"),
      start: { dateTime: start.toISO(), timeZone: TIMEZONE },
      end: { dateTime: end.toISO(), timeZone: TIMEZONE },
      attendees: [
        { email },
        ...(assignedMember.email !== GOOGLE_ACCOUNT_EMAIL ? [{ email: assignedMember.email }] : [])
      ],
      guestsCanModify: false,
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    }
  });
  return response.data;
}

app.get("/health", async (_req, res) => {
  try {
    if (pool) await pool.query("SELECT 1");
    const refreshToken = await loadRefreshToken();
    res.json({
      ok: true,
      database: Boolean(pool),
      calendarConnected: Boolean(refreshToken),
      calendarAccount: GOOGLE_ACCOUNT_EMAIL,
      bookingCalendar: BOOKING_CALENDAR_ID,
      teamMemberCount: TEAM_MEMBERS.length
    });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/google/status", async (_req, res) => {
  try {
    const connected = Boolean(await loadRefreshToken());
    res.json({ ok: true, connected, account: GOOGLE_ACCOUNT_EMAIL });
  } catch {
    res.status(500).json({ ok: false, connected: false });
  }
});

app.get("/api/google/connect", async (_req, res) => {
  try {
    const auth = oauthClient();
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: signState(),
      login_hint: GOOGLE_ACCOUNT_EMAIL
    });
    res.redirect(url);
  } catch (error) {
    console.error("google_connect_failed", error);
    res.status(503).send("Google OAuth todavía no está configurado en Railway.");
  }
});

app.get("/api/google/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !verifyState(state)) return res.status(400).send("Solicitud de autorización inválida.");

  try {
    const auth = oauthClient();
    const { tokens } = await auth.getToken(code);
    if (!tokens.refresh_token) throw new Error("No refresh token returned");
    auth.setCredentials(tokens);

    const calendar = google.calendar({ version: "v3", auth });
    const primary = await calendar.calendars.get({ calendarId: "primary" });
    if (String(primary.data.id || "").toLowerCase() !== GOOGLE_ACCOUNT_EMAIL.toLowerCase()) {
      return res.status(403).send(`Debes autorizar la cuenta ${GOOGLE_ACCOUNT_EMAIL}.`);
    }

    await saveRefreshToken(tokens.refresh_token);
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Tres Pilares</title>
      <body style="font-family:system-ui;padding:40px;background:#FCF9F3;color:#123E32">
      <h1>Google Calendar conectado</h1>
      <p>La agenda de <strong>${GOOGLE_ACCOUNT_EMAIL}</strong> quedó conectada correctamente.</p>
      <p><a href="${FRONTEND_URL}/#contacto">Volver a Tres Pilares</a></p></body>`);
  } catch (error) {
    console.error("google_callback_failed", error);
    res.status(500).send("No pudimos completar la conexión con Google Calendar.");
  }
});

app.get("/api/availability", async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "Fecha inválida." });
  }
  try {
    const result = await getAvailability(date);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error("availability_failed", error);
    const notConnected = String(error.message) === "calendar_not_connected";
    res.status(503).json({
      ok: false,
      error: notConnected
        ? "Google Calendar aún no está conectado."
        : "No pudimos consultar la agenda en este momento."
    });
  }
});

app.post("/api/appointments", async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const topic = String(body.topic || "").trim();
  const startTime = String(body.startTime || "").trim();
  const source = String(body.source || "website").trim().slice(0, 80);

  if (name.length < 2 || name.length > 120) return res.status(400).json({ ok:false, error:"Nombre inválido." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return res.status(400).json({ ok:false, error:"Email inválido." });
  if (!/^\+?[0-9\s()-]{7,22}$/.test(phone)) return res.status(400).json({ ok:false, error:"WhatsApp inválido." });
  if (topic.length < 2 || topic.length > 160) return res.status(400).json({ ok:false, error:"Selecciona un motivo." });
  if (!pool) return res.status(503).json({ ok:false, error:"Agenda temporalmente no disponible." });

  const start = DateTime.fromISO(startTime, { setZone: true }).setZone(TIMEZONE);
  if (!start.isValid) return res.status(400).json({ ok:false, error:"Horario inválido." });
  const end = start.plus({ minutes: DURATION_MIN });
  const valid = validateDate(start.toISODate());
  if (!valid.ok) return res.status(400).json(valid);
  if (start < valid.start || end > valid.end) return res.status(400).json({ ok:false, error:"Horario fuera de agenda." });
  const offsetMin = start.diff(valid.start, "minutes").minutes;
  if (offsetMin % SLOT_MIN !== 0) return res.status(400).json({ ok:false, error:"Horario inválido." });

  const client = await pool.connect();
  let event = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [start.toUTC().toISO()]);

    const [googleBusy, dbBusy] = await Promise.all([
      googleBusyByMember(valid.start, valid.end),
      dbBusyByMember(valid.start, valid.end)
    ]);
    const requestedSlot = Interval.fromDateTimes(start, end);
    const availableMembers = await getAvailableMembersForSlot(requestedSlot, googleBusy, dbBusy);
    if (!availableMembers.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok:false, error:"Ese horario acaba de ocuparse. Elige otro." });
    }

    const assignedMember = await chooseRoundRobinMember(client, availableMembers);
    event = await createCalendarEvent({ name, email, phone, topic, start, end, assignedMember });
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO appointment_requests
       (id, name, email, phone, topic, preferred_date, preferred_time, start_time, end_time,
        calendar_event_id, meet_link, assigned_member_name, assigned_member_email, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'confirmed')`,
      [
        id, name, email, phone, topic, start.toISODate(),
        start.setLocale("es").toFormat("h:mm a"),
        start.toUTC().toISO(), end.toUTC().toISO(),
        event.id || null, event.hangoutLink || null,
        assignedMember.name, assignedMember.email, source
      ]
    );
    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      id,
      start: start.toISO(),
      end: end.toISO(),
      meetLink: event.hangoutLink || null,
      calendarEventLink: event.htmlLink || null,
      assignedTo: assignedMember.name,
      message: "Tu cita quedó confirmada. Revisa tu correo para la invitación de Google Calendar."
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (event?.id) {
      try {
        const calendar = await calendarClient();
        await calendar?.events.delete({ calendarId: BOOKING_CALENDAR_ID, eventId: event.id, sendUpdates: "none" });
      } catch {}
    }
    console.error("appointment_booking_failed", error);
    res.status(500).json({ ok:false, error:"No pudimos confirmar la cita. Intenta nuevamente." });
  } finally {
    client.release();
  }
});

app.use((_req, res) => res.status(404).json({ ok:false, error:"Not found" }));

ensureSchema()
  .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`Tres Pilares API listening on port ${PORT}`)))
  .catch((error) => {
    console.error("schema_init_failed", error);
    process.exit(1);
  });
