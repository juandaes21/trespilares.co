import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);

const allowedOrigins = (process.env.FRONTEND_ORIGINS ||
  "https://trespilares.co,https://www.trespilares.co")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(express.json({ limit: "32kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
    })
  : null;

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_requests (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      topic TEXT NOT NULL,
      preferred_date DATE,
      preferred_time TEXT,
      source TEXT NOT NULL DEFAULT 'website',
      status TEXT NOT NULL DEFAULT 'new'
    );
  `);
}

app.get("/health", async (_req, res) => {
  try {
    if (pool) await pool.query("SELECT 1");
    res.json({ ok: true, database: Boolean(pool) });
  } catch {
    res.status(503).json({ ok: false, database: false });
  }
});

app.post("/api/appointments", async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const topic = String(body.topic || "").trim();
  const preferredDate = body.preferredDate ? String(body.preferredDate).trim() : null;
  const preferredTime = body.preferredTime ? String(body.preferredTime).trim() : null;
  const source = String(body.source || "website").trim().slice(0, 80);

  if (name.length < 2 || name.length > 120) {
    return res.status(400).json({ ok: false, error: "Nombre inválido." });
  }
  if (!/^\+?[0-9\s()-]{7,22}$/.test(phone)) {
    return res.status(400).json({ ok: false, error: "WhatsApp inválido." });
  }
  if (topic.length < 2 || topic.length > 160) {
    return res.status(400).json({ ok: false, error: "Selecciona un motivo." });
  }
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    return res.status(400).json({ ok: false, error: "Fecha inválida." });
  }
  if (preferredTime && preferredTime.length > 40) {
    return res.status(400).json({ ok: false, error: "Horario inválido." });
  }
  if (!pool) {
    return res.status(503).json({ ok: false, error: "Agenda temporalmente no disponible." });
  }

  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO appointment_requests
       (id, name, phone, topic, preferred_date, preferred_time, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, phone, topic, preferredDate, preferredTime, source]
    );

    return res.status(201).json({
      ok: true,
      id,
      message: "Recibimos tu solicitud. El equipo de Tres Pilares te contactará para confirmar la cita."
    });
  } catch (error) {
    console.error("appointment_insert_failed", error);
    return res.status(500).json({ ok: false, error: "No pudimos guardar tu solicitud." });
  }
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Tres Pilares API listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("schema_init_failed", error);
    process.exit(1);
  });
