import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const file = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');
const script=file('public/assets/js/calculadoras.js');

function calculate(tool, inputs){
  const items=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{value:String(v),textContent:''}]));
  for(const id of ['tool-status','gap','capital','monthly','edu-capital','edu-total','edu-monthly'])items[id]??={textContent:''};
  const document={
    body:{dataset:{tool}},
    getElementById:id=>items[id]||null,
    querySelectorAll:()=>[],
    addEventListener:(event,cb)=>{if(event==='DOMContentLoaded')cb();}
  };
  runInNewContext(script,{document,Intl,Number,Math});
  return Object.fromEntries(Object.entries(items).map(([k,v])=>[k,v.textContent]));
}

const p={age:36,ret:62,years:25,goal:9e6,expected:5e6,other:1e6,saved:5e7,real:2};
const e={child:4,start:18,degree:5,cost:25e6,infl:5,return:6,initial:10e6};

test('Brecha pensional: diferencia, capital y ahorro',()=>{
  const out=calculate('pension',p);
  assert.match(out.gap,/3.000.000/);
  assert.match(out.capital,/709.264.138/);
  assert.match(out.monthly,/1.534.289/);
});

test('Brecha cero y horizonte inconsistente',()=>{
  assert.match(calculate('pension',{...p,goal:6e6}).gap,/\b0$/);
  assert.match(calculate('pension',{...p,ret:35})['tool-status'],/Revisa/);
});

test('Educación: escenarios de matrícula e inicio inmediato',()=>{
  const out=calculate('education',e);
  assert.match(out['edu-total'],/273.509.298/);
  assert.match(out['edu-capital'],/242.865.646/);
  assert.match(out['edu-monthly'],/850.271/);
  assert.match(calculate('education',{...e,child:18,start:18})['tool-status'],/Inicio inmediato/);
});

test('Las rutas existen y conservan rutas relativas',()=>{
  for(const route of ['soluciones','empresas','legado','brecha-pensional','educacion']){
    const html=file('public/'+route+'/index.html');
    assert.match(html,/<\/html>/);
    assert.match(html,/name="robots" content="noindex,nofollow"/);
    assert.doesNotMatch(html,/https?:\/\/trespilares\.co/i);
  }
});

test('CRM integrado conserva estrategias y añade business_line',()=>{
  const backend=file('backend/crm.js'),frontend=file('backend/crm/app.js'),html=file('backend/crm/index.html');
  for(const key of ['vida_socios','legado','brecha_pensional','educacion']){
    assert.ok(backend.includes('"'+key+'"'));
    assert.ok(html.includes('value="'+key+'"'));
  }
  assert.match(backend,/ADD COLUMN IF NOT EXISTS business_line/);
  assert.match(frontend,/pipelineBusinessLine/);
  assert.match(frontend,/contactBusinessLine/);
  assert.match(backend,/corporate_talks/);
  assert.match(backend,/partner_life_insurance/);
});

test('Las calculadoras no hacen solicitudes ni almacenan datos',()=>{
  assert.doesNotMatch(script,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/);
});
