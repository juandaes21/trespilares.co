import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATABASE_URL = process.env.DATABASE_URL || "";
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || "";
const LINKEDIN_SCOPES = (process.env.LINKEDIN_SCOPES || "openid profile email")
  .split(/[ ,]+/)
  .map(v => v.trim())
  .filter(Boolean);
const LINKEDIN_STATE_SECRET = process.env.LINKEDIN_STATE_SECRET || "";
const LINKEDIN_TOKEN_ENCRYPTION_KEY = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY || "";
const LINKEDIN_SYNC_INTERNAL_KEY = process.env.LINKEDIN_SYNC_INTERNAL_KEY || "";
const CRM_RETURN_URL = process.env.CRM_RETURN_URL || "https://tres-pilares-api-production.up.railway.app/crm/";

const pool = DATABASE_URL
  ? new Pool({
      connectionString:DATABASE_URL,
      ssl:process.env.PGSSL === "disable" ? false : { rejectUnauthorized:false }
    })
  : null;

app.use(helmet({ contentSecurityPolicy:false }));
app.use(express.json({ limit:"32kb" }));

function linkedinConfigured() {
  return Boolean(
    LINKEDIN_CLIENT_ID &&
    LINKEDIN_CLIENT_SECRET &&
    LINKEDIN_REDIRECT_URI &&
    LINKEDIN_STATE_SECRET &&
    LINKEDIN_TOKEN_ENCRYPTION_KEY
  );
}

function keyBuffer() {
  if (!/^[a-f0-9]{64}$/i.test(LINKEDIN_TOKEN_ENCRYPTION_KEY)) {
    throw new Error("LINKEDIN_TOKEN_ENCRYPTION_KEY must be 64 hex chars");
  }
  return Buffer.from(LINKEDIN_TOKEN_ENCRYPTION_KEY, "hex");
}

function encryptSecret(value) {
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",keyBuffer(),iv);
  const encrypted=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [iv,tag,encrypted].map(b=>b.toString("base64url")).join(".");
}

function signState() {
  if (!LINKEDIN_STATE_SECRET) throw new Error("LINKEDIN_STATE_SECRET is not configured");
  const payload=Buffer.from(JSON.stringify({
    ts:Date.now(),
    nonce:crypto.randomBytes(16).toString("hex")
  })).toString("base64url");
  const signature=crypto.createHmac("sha256",LINKEDIN_STATE_SECRET).update(payload).digest("base64url");
  return payload+"."+signature;
}

function verifyState(value) {
  const [payload,signature]=String(value||"").split(".");
  if (!payload || !signature || !LINKEDIN_STATE_SECRET) return false;
  const expected=crypto.createHmac("sha256",LINKEDIN_STATE_SECRET).update(payload).digest("base64url");
  const left=Buffer.from(signature);
  const right=Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left,right)) return false;
  try {
    const parsed=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    return Date.now()-Number(parsed.ts) < 10*60*1000;
  } catch {
    return false;
  }
}

function internalAuth(req,res,next) {
  const supplied=String(req.get("X-Internal-Key")||"");
  if (!LINKEDIN_SYNC_INTERNAL_KEY || supplied !== LINKEDIN_SYNC_INTERNAL_KEY) {
    return res.status(401).json({ ok:false,error:"Unauthorized" });
  }
  next();
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS linkedin_integrations (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      member_sub TEXT,
      member_name TEXT,
      member_email TEXT,
      encrypted_access_token TEXT,
      encrypted_refresh_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_expires_at TIMESTAMPTZ,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected',
      last_sync_at TIMESTAMPTZ,
      last_error TEXT
    );
    INSERT INTO linkedin_integrations(id,status)
    VALUES (1,'disconnected')
    ON CONFLICT (id) DO NOTHING;
  `);
}

async function exchangeCode(code) {
  const body=new URLSearchParams({
    grant_type:"authorization_code",
    code,
    redirect_uri:LINKEDIN_REDIRECT_URI,
    client_id:LINKEDIN_CLIENT_ID,
    client_secret:LINKEDIN_CLIENT_SECRET
  });
  const response=await fetch("https://www.linkedin.com/oauth/v2/accessToken",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body
  });
  const data=await response.json().catch(()=>({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "linkedin_token_exchange_failed");
  }
  return data;
}

async function fetchUserInfo(accessToken) {
  const response=await fetch("https://api.linkedin.com/v2/userinfo",{
    headers:{ Authorization:"Bearer "+accessToken }
  });
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || "linkedin_userinfo_failed");
  return data;
}

app.get("/health",async (_req,res)=>{
  try {
    if (pool) await pool.query("SELECT 1");
    res.json({
      ok:true,
      database:Boolean(pool),
      configured:linkedinConfigured(),
      scopes:LINKEDIN_SCOPES
    });
  } catch {
    res.status(503).json({ ok:false });
  }
});

app.get("/oauth/linkedin",(_req,res)=>{
  if (!linkedinConfigured()) {
    return res.status(503).send("LinkedIn OAuth todavía no está configurado.");
  }
  const params=new URLSearchParams({
    response_type:"code",
    client_id:LINKEDIN_CLIENT_ID,
    redirect_uri:LINKEDIN_REDIRECT_URI,
    state:signState(),
    scope:LINKEDIN_SCOPES.join(" ")
  });
  res.redirect("https://www.linkedin.com/oauth/v2/authorization?"+params.toString());
});

app.get("/oauth/linkedin/callback",async (req,res)=>{
  const code=String(req.query.code||"");
  const state=String(req.query.state||"");
  if (!code || !verifyState(state)) {
    return res.status(400).send("Solicitud de autorización inválida.");
  }
  if (!pool) return res.status(503).send("Base de datos no disponible.");

  try {
    const token=await exchangeCode(code);
    const user=await fetchUserInfo(token.access_token);
    const accessExpiresAt=token.expires_in
      ? new Date(Date.now()+Number(token.expires_in)*1000).toISOString()
      : null;
    const refreshExpiresAt=token.refresh_token_expires_in
      ? new Date(Date.now()+Number(token.refresh_token_expires_in)*1000).toISOString()
      : null;

    await pool.query(
      `UPDATE linkedin_integrations
          SET member_sub=$2,
              member_name=$3,
              member_email=$4,
              encrypted_access_token=$5,
              encrypted_refresh_token=$6,
              access_token_expires_at=$7,
              refresh_token_expires_at=$8,
              scopes=$9,
              status='connected',
              last_error=NULL,
              updated_at=NOW()
        WHERE id=$1`,
      [
        1,
        user.sub || null,
        user.name || null,
        user.email || null,
        encryptSecret(token.access_token),
        token.refresh_token ? encryptSecret(token.refresh_token) : null,
        accessExpiresAt,
        refreshExpiresAt,
        LINKEDIN_SCOPES
      ]
    );

    res.redirect(CRM_RETURN_URL+"?linkedin=connected");
  } catch (error) {
    console.error("linkedin_oauth_callback_failed",error);
    await pool.query(
      "UPDATE linkedin_integrations SET status='error',last_error=$2,updated_at=NOW() WHERE id=$1",
      [1,String(error.message||error).slice(0,1000)]
    ).catch(()=>{});
    res.redirect(CRM_RETURN_URL+"?linkedin=error");
  }
});

app.get("/internal/status",internalAuth,async (_req,res)=>{
  if (!pool) return res.status(503).json({ ok:false,error:"Database unavailable" });
  const result=await pool.query(
    `SELECT status,member_name,member_email,scopes,access_token_expires_at,
            refresh_token_expires_at,last_sync_at,last_error,updated_at
       FROM linkedin_integrations WHERE id=1`
  );
  res.json({
    ok:true,
    integration:result.rows[0] || null,
    capabilities:{
      openId:LINKEDIN_SCOPES.includes("openid"),
      invitations:false,
      connections:false,
      messages:false
    },
    note:"Invitations, connections and messages remain disabled until LinkedIn explicitly grants the required partner permissions."
  });
});

app.post("/internal/mark-sync",internalAuth,async (req,res)=>{
  if (!pool) return res.status(503).json({ ok:false,error:"Database unavailable" });
  const error=String(req.body?.error||"").trim().slice(0,1000);
  await pool.query(
    `UPDATE linkedin_integrations
        SET last_sync_at=NOW(),
            last_error=$2,
            updated_at=NOW()
      WHERE id=$1`,
    [1,error || null]
  );
  res.json({ ok:true });
});

app.use((_req,res)=>res.status(404).json({ ok:false,error:"Not found" }));

ensureSchema()
  .then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("LinkedIn Sync listening on port "+PORT)))
  .catch(error=>{
    console.error("linkedin_sync_start_failed",error);
    process.exit(1);
  });
