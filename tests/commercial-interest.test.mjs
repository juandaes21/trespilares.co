import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {validateInterest,saveCommercialInterest,LINEAS} from "../backend/commercial-core.js";

const valid=(overrides={})=>({
  requestId:crypto.randomUUID(),name:"Persona Demo",email:"demo@example.test",
  phone:"",businessLine:"vida_socios",intent:"conversation",consent:true,
  attribution:{source:"instagram",medium:"social"},...overrides
});
function mockDB({existing=false,duplicate=false,taskPresent=false}={}){
 const queries=[];let committed=false,rolled=false,released=false;
 const client={release(){released=true;},async query(sql,params=[]){
  queries.push({sql,params});
  if(/SELECT contact_id FROM crm_commercial_requests/.test(sql))return {rowCount:duplicate?1:0,rows:duplicate?[{contact_id:"x"}]:[]};
  if(/SELECT id,owner_user_id,business_line,stage FROM crm_contacts/.test(sql))
    return {rowCount:existing?1:0,rows:existing?[{id:"contact-existing",stage:"diagnostic",owner_user_id:"user1",business_line:"legado"}]:[]};
  if(/SELECT id FROM crm_users/.test(sql))return {rowCount:1,rows:[{id:"user1"}]};
  if(sql==="COMMIT")committed=true;
  if(sql==="ROLLBACK")rolled=true;
  return {rowCount:1,rows:[]};
 }};
 return {pool:{connect:async()=>client},queries,flags:()=>({committed,rolled,released})};
}
test("validación y consentimiento limitado",()=>{
 const x=validateInterest(valid());assert.equal(x.ok,true);assert.equal(x.lead.businessLine,"vida_socios");
 assert.equal(validateInterest(valid({consent:false})).ok,false);
 assert.equal(validateInterest(valid({businessLine:"invalid"})).ok,false);
 assert.equal(validateInterest(valid({email:"bad email"})).ok,false);
 assert.equal(validateInterest(valid({intent:"marketing"})).ok,false);
 assert.equal(Object.keys(x.lead).includes("pensionAmount"),false);
});
test("crea contacto y recordatorio interno sin envío de mensajes",async()=>{
 const m=mockDB();const x=validateInterest(valid()).lead;
 const out=await saveCommercialInterest(m.pool,x);
 assert.equal(out.ok,true);
 assert(m.queries.some(q=>q.sql.includes("INSERT INTO crm_contacts")));
 assert(m.queries.some(q=>q.sql.includes("INSERT INTO crm_tasks")));
 assert(m.queries.some(q=>q.sql.includes("INSERT INTO crm_commercial_requests")));
 assert(!m.queries.some(q=>/SEND|smtp|whatsapp_api/i.test(q.sql)));
 assert(m.flags().committed&&m.flags().released);
});
test("deduplica solicitudes repetidas",async()=>{
 const m=mockDB({duplicate:true});const out=await saveCommercialInterest(m.pool,validateInterest(valid()).lead);
 assert.equal(out.duplicate,true);
 assert(!m.queries.some(q=>q.sql.includes("INSERT INTO crm_contacts")));
 assert(m.flags().committed);
});
test("reutiliza contacto existente preservando su línea previa",async()=>{
 const m=mockDB({existing:true});
 await saveCommercialInterest(m.pool,validateInterest(valid({businessLine:"brecha_pensional"})).lead);
 const q=m.queries.find(x=>x.sql.includes("UPDATE crm_contacts"));
 assert(q);assert.match(q.sql,/business_line=COALESCE\(business_line,\$2\)/);
 assert(!m.queries.some(x=>x.sql.includes("INSERT INTO crm_contacts")));
});
test("etiquetas cubren exactamente las cuatro líneas",()=>{
 assert.deepEqual(Object.keys(LINEAS).sort(),["vida_socios","legado","brecha_pensional","educacion"].sort());
});
