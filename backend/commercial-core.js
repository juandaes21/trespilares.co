import crypto from "node:crypto";

export const LINEAS = Object.freeze({
  vida_socios:{label:"Vida Socios",pillar:"Protege",strategy:"partner_life_insurance"},
  legado:{label:"Legado",pillar:"Proyecta",strategy:"direct_sales"},
  brecha_pensional:{label:"Brecha pensional",pillar:"Proyecta",strategy:"direct_sales"},
  educacion:{label:"Educación de los hijos",pillar:"Construye",strategy:"direct_sales"}
});
export const CONSENT_VERSION="tp-responder-solicitud-v1-2026-11";
const clean=(v,max)=>String(v??"").trim().slice(0,max);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validUUID=value=>UUID.test(String(value??""));

export function validateInterest(raw){
  const b=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  const name=clean(b.name,121),email=clean(b.email,201).toLowerCase(),phone=clean(b.phone,24);
  const line=clean(b.businessLine,50),requestId=clean(b.requestId,64);
  if (!validUUID(requestId)) return {ok:false,error:"No pudimos identificar la solicitud. Recarga e inténtalo de nuevo."};
  if (!(line in LINEAS)) return {ok:false,error:"Selecciona una línea de planificación válida."};
  if(name.length<2||name.length>120)return {ok:false,error:"Indica tu nombre."};
  if(email.length>200||!EMAIL.test(email))return {ok:false,error:"Ingresa un correo electrónico válido."};
  if(phone&&!/^\+?[0-9\s()-]{7,22}$/.test(phone))return {ok:false,error:"Revisa el número de contacto."};
  if(b.consent!==true)return {ok:false,error:"Necesitamos tu autorización para responder esta solicitud."};
  if(b.intent!=="conversation")return {ok:false,error:"El tipo de solicitud no es válido."};
  const attr=b.attribution&&typeof b.attribution==="object"&&!Array.isArray(b.attribution)?b.attribution:{};
  const attribution={
    source:clean(attr.source,80)||"website",
    medium:clean(attr.medium,80),
    campaign:clean(attr.campaign,120),
    content:clean(attr.content,120),
    referrer:clean(attr.referrer,500),
    landingUrl:clean(attr.landingUrl,600)
  };
  return {ok:true,lead:{requestId,name,email,phone:phone||null,businessLine:line,attribution}};
}

export async function ensureCommercialSchema(pool){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS crm_commercial_requests (
      request_id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      contact_id UUID NOT NULL REFERENCES crm_contacts(id),
      business_line TEXT NOT NULL CHECK (business_line IN ('vida_socios','legado','brecha_pensional','educacion')),
      email TEXT NOT NULL,
      consent_at TIMESTAMPTZ NOT NULL,
      consent_version TEXT NOT NULL,
      consent_scope TEXT NOT NULL DEFAULT 'respuesta_a_solicitud_individual',
      attribution JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS crm_commercial_requests_contact_idx
      ON crm_commercial_requests(contact_id,created_at DESC);
  `);
}

// Safely handles idempotent website requests. This does NOT send emails or marketing messages.
export async function saveCommercialInterest(pool,lead,{defaultOwnerEmail=""}={}){
  if(!pool)throw new Error("NO_DATABASE");
  const client=await pool.connect();
  let transaction=false;
  try {
    await client.query("BEGIN");transaction=true;
    // Lock by email to avoid duplicate active contacts on concurrent requests.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[lead.email]);
    const duplicate=await client.query(
      "SELECT contact_id FROM crm_commercial_requests WHERE request_id=$1",
      [lead.requestId]
    );
    if(duplicate.rowCount){
      await client.query("COMMIT");transaction=false;
      return {ok:true,duplicate:true};
    }
    const meta=LINEAS[lead.businessLine];
    if(!meta)throw new Error("INVALID_LINE");
    const existing=await client.query(
      "SELECT id,owner_user_id,business_line,stage FROM crm_contacts WHERE archived=FALSE AND LOWER(email)=LOWER($1) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [lead.email]
    );
    let contactId,ownerId;
    if(existing.rowCount){
      const row=existing.rows[0];
      contactId=row.id;ownerId=row.owner_user_id||null;
      await client.query(
        `UPDATE crm_contacts SET
         business_line=COALESCE(business_line,$2),
         phone=COALESCE(phone,$3),
         stage=CASE WHEN stage='target' THEN 'engaged' ELSE stage END,
         last_contact_at=NOW(),updated_at=NOW(),
         last_touch=$4::jsonb
         WHERE id=$1`,
        [contactId,lead.businessLine,lead.phone,JSON.stringify(lead.attribution)]
      );
    }else{
      const owner=await client.query(
        `SELECT id FROM crm_users
           WHERE active=TRUE AND role IN ('admin','member')
           ORDER BY CASE WHEN LOWER(COALESCE(team_member_email,email))=LOWER($1) THEN 0 ELSE 1 END,
                    CASE WHEN role='admin' THEN 0 ELSE 1 END,created_at ASC LIMIT 1`,
        [defaultOwnerEmail]
      );
      ownerId=owner.rows[0]?.id||null;
      contactId=crypto.randomUUID();
      await client.query(
        `INSERT INTO crm_contacts
          (id,name,email,phone,owner_user_id,source_channel,source_profile,source_detail,
           stage,strategy,business_line,interest_pillar,signal,first_touch,last_touch,last_contact_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'engaged',$9,$10,$11,$12,$13::jsonb,$13::jsonb,NOW())`,
        [contactId,lead.name,lead.email,lead.phone,ownerId,lead.attribution.source,
         lead.attribution.campaign||null,lead.attribution.content||null,meta.strategy,
         lead.businessLine,meta.pillar,"Solicitó una conversación sobre "+meta.label,
         JSON.stringify(lead.attribution)]
      );
    }
    await client.query(
      `INSERT INTO crm_commercial_requests
        (request_id,contact_id,business_line,email,consent_at,consent_version,consent_scope,attribution)
        VALUES ($1,$2,$3,$4,NOW(),$5,'respuesta_a_solicitud_individual',$6::jsonb)`,
      [lead.requestId,contactId,lead.businessLine,lead.email,CONSENT_VERSION,JSON.stringify(lead.attribution)]
    );
    await client.query(
      `INSERT INTO crm_activities(id,contact_id,type,direction,summary,metadata)
       VALUES ($1,$2,'note','inbound',$3,$4::jsonb)`,
      [crypto.randomUUID(),contactId,"Solicitud de conversación · "+meta.label,
       JSON.stringify({event:"commercial_interest",line:lead.businessLine,requestId:lead.requestId,consentVersion:CONSENT_VERSION})]
    );
    // Internal reminder only; one open task per lead and business line.
    await client.query(
      `INSERT INTO crm_tasks(id,contact_id,type,title,notes,due_at,status,priority,assigned_user_id)
       SELECT $1,$2,'custom',$3,$4,NOW()+INTERVAL '1 day','open','normal',$5
       WHERE NOT EXISTS(SELECT 1 FROM crm_tasks WHERE contact_id=$2 AND title=$3 AND status='open')`,
      [crypto.randomUUID(),contactId,"Responder solicitud · "+meta.label,
       "Contacto solicitó conversar. Verifica la autorización antes de utilizar sus datos; no enviar campañas.",
       ownerId]
    );
    await client.query("COMMIT");transaction=false;
    return {ok:true,duplicate:false};
  }catch(error){
    if(transaction)try{await client.query("ROLLBACK");}catch{}
    throw error;
  }finally{client.release();}
}
