import express from "express";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);

const ISSUER = "tres-pilares-auth";
const AUDIENCE = "tres-pilares-crm";
const ACCESS_TTL_SECONDS = Number(process.env.CRM_ACCESS_TTL_SECONDS || 43200);
const OAUTH_STATE_COOKIE = "tp_crm_oauth_state";

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString:process.env.DATABASE_URL,
      ssl:process.env.PGSSL === "disable" ? false : { rejectUnauthorized:false }
    })
  : null;

app.use(helmet({ contentSecurityPolicy:false }));
app.use(express.json({ limit:"16kb" }));

function cleanText(value, max=500) {
  return String(value ?? "").trim().slice(0,max);
}

function normalizeEmail(value) {
  return cleanText(value,200).toLowerCase();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part)=>part.trim())
      .filter(Boolean)
      .map((part)=>{
        const i=part.indexOf("=");
        return i < 0
          ? [part,""]
          : [part.slice(0,i),decodeURIComponent(part.slice(i+1))];
      })
  );
}

function safeTimingEqual(a,b) {
  const aa=Buffer.from(String(a||""));
  const bb=Buffer.from(String(b||""));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value||"")).digest("hex");
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signAccessToken(user) {
  const secret=String(process.env.CRM_AUTH_JWT_SECRET || "");
  if(secret.length < 32) throw new Error("CRM_AUTH_JWT_SECRET must be at least 32 characters");

  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({ alg:"HS256",typ:"JWT" }));
  const payload=b64url(JSON.stringify({
    sub:user.id,
    email:user.email,
    iss:ISSUER,
    aud:AUDIENCE,
    iat:now,
    exp:now+ACCESS_TTL_SECONDS,
    jti:crypto.randomUUID()
  }));
  const signature=crypto
    .createHmac("sha256",secret)
    .update(header+"."+payload)
    .digest("base64url");
  return header+"."+payload+"."+signature;
}

function stateCookie(res,value,maxAge=600) {
  res.setHeader(
    "Set-Cookie",
    OAUTH_STATE_COOKIE+"="+encodeURIComponent(value)+
      "; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge
  );
}

function clearStateCookie(res) {
  res.setHeader(
    "Set-Cookie",
    OAUTH_STATE_COOKIE+"=; Path=/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
  );
}

function googleConfig() {
  const clientId=String(process.env.CRM_GOOGLE_CLIENT_ID || "");
  const clientSecret=String(process.env.CRM_GOOGLE_CLIENT_SECRET || "");
  const redirectUri=String(process.env.CRM_GOOGLE_REDIRECT_URI || "");
  if(!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured");
  }
  return { clientId,clientSecret,redirectUri };
}

async function exchangeGoogleCode(code) {
  const { clientId,clientSecret,redirectUri }=googleConfig();
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      code,
      client_id:clientId,
      client_secret:clientSecret,
      redirect_uri:redirectUri,
      grant_type:"authorization_code"
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.access_token) throw new Error("google_token_exchange_failed");
  return data;
}

async function googleIdentity(accessToken) {
  const response=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{
    headers:{ Authorization:"Bearer "+accessToken }
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok || !data.sub || !data.email) throw new Error("google_identity_failed");
  return data;
}

function requireInternal(req,res,next) {
  const configured=String(process.env.CRM_AUTH_INTERNAL_KEY || "");
  const supplied=String(req.headers["x-internal-key"] || "");
  if(configured.length < 24 || !safeTimingEqual(configured,supplied)) {
    return res.status(403).json({ ok:false,error:"Forbidden" });
  }
  next();
}

async function ensureSchema() {
  if(!pool) throw new Error("DATABASE_URL is required");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_users (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      team_member_email TEXT,
      google_sub TEXT,
      avatar_url TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMPTZ
    );

    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS google_sub TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS team_member_email TEXT;
    ALTER TABLE crm_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE UNIQUE INDEX IF NOT EXISTS crm_users_google_sub_unique_idx
      ON crm_users(google_sub) WHERE google_sub IS NOT NULL;

    CREATE TABLE IF NOT EXISTS auth_login_grants (
      code_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES crm_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS auth_login_grants_expiry_idx
      ON auth_login_grants(expires_at);

    DELETE FROM auth_login_grants
     WHERE expires_at < NOW() - INTERVAL '1 day'
        OR used_at < NOW() - INTERVAL '1 day';
  `);
}

app.get("/health",async(_req,res)=>{
  try{
    await pool.query("SELECT 1");
    res.json({ ok:true,service:"tres-pilares-crm-auth" });
  }catch{
    res.status(503).json({ ok:false });
  }
});

app.get("/auth/google",async(_req,res)=>{
  try{
    const { clientId,redirectUri }=googleConfig();
    const state=crypto.randomBytes(32).toString("base64url");
    stateCookie(res,state);
    const params=new URLSearchParams({
      client_id:clientId,
      redirect_uri:redirectUri,
      response_type:"code",
      scope:"openid email profile",
      state,
      prompt:"select_account",
      access_type:"online"
    });
    res.redirect("https://accounts.google.com/o/oauth2/v2/auth?"+params.toString());
  }catch(error){
    console.error("google_oauth_start_failed",error);
    res.status(503).send("Google OAuth no está configurado.");
  }
});

app.get("/auth/google/callback",async(req,res)=>{
  const code=cleanText(req.query.code,3000);
  const state=cleanText(req.query.state,500);
  const expected=parseCookies(req)[OAUTH_STATE_COOKIE] || "";
  clearStateCookie(res);

  if(!code || !state || !expected || !safeTimingEqual(state,expected)) {
    return res.status(400).send("Solicitud OAuth inválida.");
  }

  try{
    const tokens=await exchangeGoogleCode(code);
    const profile=await googleIdentity(tokens.access_token);
    const email=normalizeEmail(profile.email);

    if(profile.email_verified === false) {
      return res.status(403).send("La cuenta de Google no tiene un email verificado.");
    }

    let result=await pool.query(
      "SELECT * FROM crm_users WHERE email=$1 AND active=TRUE LIMIT 1",
      [email]
    );

    if(!result.rowCount) {
      const total=await pool.query("SELECT COUNT(*)::int AS count FROM crm_users");
      const bootstrapEmail=normalizeEmail(process.env.CRM_BOOTSTRAP_ADMIN_EMAIL || "trespilares.co@gmail.com");
      if(Number(total.rows[0].count)===0 && bootstrapEmail && email===bootstrapEmail) {
        const id=crypto.randomUUID();
        await pool.query(
          `INSERT INTO crm_users(id,name,email,role,team_member_email,google_sub,avatar_url,last_login_at)
           VALUES ($1,$2,$3,'admin',$3,$4,$5,NOW())`,
          [
            id,
            cleanText(profile.name || email,120),
            email,
            profile.sub,
            cleanText(profile.picture,1000) || null
          ]
        );
        result=await pool.query("SELECT * FROM crm_users WHERE id=$1",[id]);
      }else{
        const denied=String(process.env.CRM_DENIED_REDIRECT_URL || process.env.CRM_LOGIN_CALLBACK_URL || "");
        if(denied) {
          const u=new URL(denied);
          u.searchParams.set("auth","not_authorized");
          return res.redirect(u.toString());
        }
        return res.status(403).send("Tu cuenta todavía no tiene acceso al CRM.");
      }
    }

    const user=result.rows[0];
    if(user.google_sub && user.google_sub !== profile.sub) {
      return res.status(403).send("La identidad de Google no coincide con el usuario autorizado.");
    }

    await pool.query(
      `UPDATE crm_users
          SET google_sub=COALESCE(google_sub,$2),
              name=COALESCE(NULLIF($3,''),name),
              avatar_url=$4,
              last_login_at=NOW(),
              updated_at=NOW()
        WHERE id=$1`,
      [
        user.id,
        profile.sub,
        cleanText(profile.name,120),
        cleanText(profile.picture,1000) || null
      ]
    );

    const rawGrant=crypto.randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO auth_login_grants(code_hash,user_id,expires_at)
       VALUES ($1,$2,NOW()+INTERVAL '2 minutes')`,
      [hashToken(rawGrant),user.id]
    );

    const callback=String(process.env.CRM_LOGIN_CALLBACK_URL || "");
    if(!callback) throw new Error("CRM_LOGIN_CALLBACK_URL is required");
    const redirect=new URL(callback);
    redirect.searchParams.set("code",rawGrant);
    res.redirect(redirect.toString());
  }catch(error){
    console.error("google_oauth_callback_failed",error);
    res.status(500).send("No pudimos completar el acceso con Google.");
  }
});

app.post("/internal/exchange",requireInternal,async(req,res)=>{
  const code=cleanText(req.body?.code,500);
  if(!code) return res.status(400).json({ ok:false,error:"Code required" });

  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const grant=await client.query(
      `SELECT g.*,u.*
         FROM auth_login_grants g
         JOIN crm_users u ON u.id=g.user_id
        WHERE g.code_hash=$1
          AND g.used_at IS NULL
          AND g.expires_at>NOW()
          AND u.active=TRUE
        FOR UPDATE`,
      [hashToken(code)]
    );
    if(!grant.rowCount) {
      await client.query("ROLLBACK");
      return res.status(401).json({ ok:false,error:"Grant inválido o vencido." });
    }

    const row=grant.rows[0];
    await client.query(
      "UPDATE auth_login_grants SET used_at=NOW() WHERE code_hash=$1",
      [hashToken(code)]
    );
    await client.query("COMMIT");

    res.json({
      ok:true,
      accessToken:signAccessToken(row),
      expiresIn:ACCESS_TTL_SECONDS,
      user:{
        id:row.user_id,
        name:row.name,
        email:row.email,
        role:row.role,
        teamMemberEmail:row.team_member_email || null,
        avatarUrl:row.avatar_url || null
      }
    });
  }catch(error){
    try{ await client.query("ROLLBACK"); }catch{}
    console.error("grant_exchange_failed",error);
    res.status(500).json({ ok:false,error:"No pudimos completar el inicio de sesión." });
  }finally{
    client.release();
  }
});

app.get("/internal/users",requireInternal,async(_req,res)=>{
  const result=await pool.query(
    "SELECT id,name,email,role,team_member_email,avatar_url,active,last_login_at,created_at FROM crm_users ORDER BY active DESC,name"
  );
  res.json({ ok:true,users:result.rows });
});

app.post("/internal/users",requireInternal,async(req,res)=>{
  const name=cleanText(req.body?.name,120);
  const email=normalizeEmail(req.body?.email);
  const role=["admin","member","viewer"].includes(req.body?.role) ? req.body.role : "member";
  const teamMemberEmail=normalizeEmail(req.body?.teamMemberEmail || email);

  if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok:false,error:"Nombre y email válidos son obligatorios." });
  }

  try{
    const id=crypto.randomUUID();
    await pool.query(
      `INSERT INTO crm_users(id,name,email,role,team_member_email)
       VALUES ($1,$2,$3,$4,$5)`,
      [id,name,email,role,teamMemberEmail]
    );
    res.status(201).json({ ok:true,id });
  }catch(error){
    if(String(error.code)==="23505") {
      return res.status(409).json({ ok:false,error:"Ya existe un usuario con ese email." });
    }
    console.error("create_user_failed",error);
    res.status(500).json({ ok:false,error:"No pudimos crear el usuario." });
  }
});

app.patch("/internal/users/:id",requireInternal,async(req,res)=>{
  const sets=[];
  const params=[];
  const fields={
    name:["name",120],
    email:["email",200],
    role:["role",30],
    teamMemberEmail:["team_member_email",200],
    active:["active",null]
  };

  for(const [input,[column,max]] of Object.entries(fields)) {
    if(!Object.prototype.hasOwnProperty.call(req.body||{},input)) continue;
    let value=req.body[input];
    if(input==="active") value=Boolean(value);
    else if(input==="email" || input==="teamMemberEmail") value=normalizeEmail(value);
    else value=cleanText(value,max);
    if(input==="role" && !["admin","member","viewer"].includes(value)) {
      return res.status(400).json({ ok:false,error:"Rol inválido." });
    }
    params.push(value);
    sets.push(column+"=$"+params.length);
  }

  if(!sets.length) return res.json({ ok:true });

  try{
    const current=await pool.query(
      "SELECT id,role,active FROM crm_users WHERE id=$1 LIMIT 1",
      [req.params.id]
    );
    if(!current.rowCount) {
      return res.status(404).json({ ok:false,error:"Usuario no encontrado." });
    }

    const user=current.rows[0];
    const removingAdmin =
      user.active === true &&
      user.role === "admin" &&
      (
        (Object.prototype.hasOwnProperty.call(req.body||{},"active") && req.body.active === false) ||
        (Object.prototype.hasOwnProperty.call(req.body||{},"role") && req.body.role !== "admin")
      );

    if(removingAdmin) {
      const admins=await pool.query(
        "SELECT COUNT(*)::int AS count FROM crm_users WHERE active=TRUE AND role='admin'"
      );
      if(Number(admins.rows[0].count) <= 1) {
        return res.status(409).json({
          ok:false,
          error:"Debe quedar al menos un administrador activo."
        });
      }
    }

    params.push(req.params.id);
    const result=await pool.query(
      "UPDATE crm_users SET "+sets.join(",")+",updated_at=NOW() WHERE id=$"+params.length+" RETURNING id,active,role",
      params
    );
    res.json({ ok:true,user:result.rows[0] });
  }catch(error){
    if(String(error.code)==="23505") {
      return res.status(409).json({ ok:false,error:"Ese email ya está en uso." });
    }
    console.error("update_user_failed",error);
    res.status(500).json({ ok:false,error:"No pudimos actualizar el usuario." });
  }
});

app.use((_req,res)=>res.status(404).json({ ok:false,error:"Not found" }));

ensureSchema()
  .then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("Tres Pilares CRM Auth listening on "+PORT)))
  .catch((error)=>{
    console.error("auth_schema_init_failed",error);
    process.exit(1);
  });
