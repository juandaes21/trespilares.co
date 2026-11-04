import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import express from "express";
import {ensureCrmSchema} from "../crm.js";
import {ensureCommercialSchema} from "../commercial-core.js";
import {createCommercialRouter} from "../commercial.js";

const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
let server,origin;
const request=(changes={})=>({
  requestId:crypto.randomUUID(),
  businessLine:"vida_socios",name:"Prospecto QA",email:"qa-contacto@example.test",
  intent:"conversation",consent:true,phone:"+57 300 111 2233",
  attribution:{source:"qa",medium:"integration"},...changes
});
async function submit(payload,pathname="/api/commercial/interests"){
  const res=await fetch(origin+pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  return {status:res.status,data:await res.json()};
}
before(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw Error("TEST_DATABASE_URL requerido; nunca usar una BD de producción");
  await pool.query("CREATE TABLE IF NOT EXISTS appointment_requests (id UUID PRIMARY KEY)");
  await ensureCrmSchema(pool);
  await ensureCommercialSchema(pool);
  await pool.query(
    "INSERT INTO crm_users(id,name,email,role,active) VALUES($1,'Asesor QA','qa-owner@example.test','admin',TRUE)",
    [crypto.randomUUID()]
  );
  const app=express();
  app.use(express.json({limit:"32kb"}));
  app.use("/api/commercial",createCommercialRouter({pool,enabled:()=>true}));
  app.use("/disabled",createCommercialRouter({pool,enabled:()=>false}));
  server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  origin="http://127.0.0.1:"+server.address().port;
});
after(async()=>{
  if(server)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  await pool.end();
});
test("POST registra prospecto con consentimiento, línea y tarea",async()=>{
  const r=await submit(request());
  assert.equal(r.status,202);
  const c=await pool.query("SELECT id,business_line,strategy,stage,owner_user_id FROM crm_contacts");
  assert.equal(c.rowCount,1);
  assert.equal(c.rows[0].business_line,"vida_socios");
  assert.equal(c.rows[0].strategy,"partner_life_insurance");
  assert.equal(c.rows[0].stage,"engaged");
  assert(c.rows[0].owner_user_id);
  const consent=await pool.query("SELECT business_line,consent_version,consent_scope FROM crm_commercial_requests");
  assert.equal(consent.rowCount,1);
  assert.equal(consent.rows[0].consent_scope,"respuesta_a_solicitud_individual");
  const tasks=await pool.query("SELECT assigned_user_id,title FROM crm_tasks");
  assert.equal(tasks.rowCount,1);
  assert(tasks.rows[0].assigned_user_id);
});
test("Reenvío idempotente no duplica actividad ni tarea",async()=>{
  const p=request({email:"dedup@example.test"});
  assert.equal((await submit(p)).status,202);
  assert.equal((await submit(p)).status,202);
  const q=await pool.query("SELECT COUNT(*)::int AS n FROM crm_commercial_requests WHERE email=$1",[p.email]);
  assert.equal(q.rows[0].n,1);
  const t=await pool.query("SELECT COUNT(*)::int AS n FROM crm_tasks t JOIN crm_contacts c ON c.id=t.contact_id WHERE c.email=$1",[p.email]);
  assert.equal(t.rows[0].n,1);
});
test("Otro interés mantiene el contacto y su línea inicial",async()=>{
  const p=request({email:"multilinea@example.test",businessLine:"legado"});
  assert.equal((await submit(p)).status,202);
  assert.equal((await submit(request({email:p.email,businessLine:"educacion"}))).status,202);
  const c=await pool.query("SELECT id,business_line FROM crm_contacts WHERE email=$1",[p.email]);
  assert.equal(c.rowCount,1);
  assert.equal(c.rows[0].business_line,"legado");
  const interests=await pool.query("SELECT business_line FROM crm_commercial_requests WHERE email=$1",[p.email]);
  assert.deepEqual(interests.rows.map(x=>x.business_line).sort(),["educacion","legado"]);
  const activities=await pool.query("SELECT metadata FROM crm_activities WHERE contact_id=$1",[c.rows[0].id]);
  assert.equal(activities.rowCount,2);
});
test("Sin consentimiento o endpoint desactivado no inserta",async()=>{
  assert.equal((await submit(request({email:"no-consent@example.test",consent:false}))).status,400);
  assert.equal((await submit(request({email:"disabled@example.test"}),"/disabled/interests")).status,503);
  assert.equal((await submit(request({email:"honeypot@example.test",website:"http://spam.test"}))).status,202);
  const q=await pool.query("SELECT COUNT(*)::int AS n FROM crm_contacts WHERE email=ANY($1)",[["no-consent@example.test","disabled@example.test","honeypot@example.test"]]);
  assert.equal(q.rows[0].n,0);
});
