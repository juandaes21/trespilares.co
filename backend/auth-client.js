import crypto from "node:crypto";

const COOKIE_NAME = "tp_crm_access";
const ISSUER = "tres-pilares-auth";
const AUDIENCE = "tres-pilares-crm";

function b64urlDecode(value) {
  return Buffer.from(String(value || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
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

function verifyJwt(token) {
  const secret = String(process.env.CRM_AUTH_JWT_SECRET || "");
  if (secret.length < 32) throw new Error("CRM_AUTH_JWT_SECRET must be at least 32 characters");

  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("invalid_token");

  const [headerEncoded,payloadEncoded,signatureEncoded] = parts;
  const header = JSON.parse(b64urlDecode(headerEncoded).toString("utf8"));
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("invalid_algorithm");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(headerEncoded + "." + payloadEncoded)
    .digest("base64url");

  const provided = Buffer.from(signatureEncoded);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) {
    throw new Error("invalid_signature");
  }

  const payload = JSON.parse(b64urlDecode(payloadEncoded).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) <= now) throw new Error("expired_token");
  if (payload.iss !== ISSUER) throw new Error("invalid_issuer");
  if (payload.aud !== AUDIENCE) throw new Error("invalid_audience");
  if (!payload.sub) throw new Error("invalid_subject");
  return payload;
}

export function crmAuth(pool) {
  return async function crmAuthMiddleware(req, res, next) {
    if (!pool) return res.status(503).json({ ok:false, error:"CRM no disponible." });
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return res.status(401).json({ ok:false, error:"Sesión requerida." });

    try {
      const claims = verifyJwt(token);
      const result = await pool.query(
        "SELECT id,name,email,role,team_member_email,avatar_url,active FROM crm_users WHERE id=$1 AND active=TRUE LIMIT 1",
        [claims.sub]
      );
      if (!result.rowCount) return res.status(401).json({ ok:false, error:"Acceso revocado." });
      req.crmUser = result.rows[0];
      req.crmClaims = claims;
      next();
    } catch (error) {
      res.status(401).json({ ok:false, error:"Sesión inválida o vencida." });
    }
  };
}

export function crmAdmin(req, res, next) {
  if (req.crmUser?.role !== "admin") {
    return res.status(403).json({ ok:false, error:"Permiso de administrador requerido." });
  }
  next();
}

export function crmWriteAccess(req, res, next) {
  if (!["admin","member"].includes(req.crmUser?.role)) {
    return res.status(403).json({ ok:false, error:"Tu acceso es de solo lectura." });
  }
  next();
}

export async function authServiceRequest(path, options = {}) {
  const base = String(process.env.CRM_AUTH_SERVICE_URL || "").replace(/\/$/, "");
  const internalKey = String(process.env.CRM_AUTH_INTERNAL_KEY || "");
  if (!base || !internalKey) throw new Error("CRM auth service is not configured");

  const response = await fetch(base + path, {
    method: options.method || "GET",
    headers: {
      "Content-Type":"application/json",
      "X-Internal-Key":internalKey,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Auth service request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function authServiceUrl(path = "") {
  const base = String(process.env.CRM_AUTH_SERVICE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("CRM_AUTH_SERVICE_URL is not configured");
  return base + path;
}
