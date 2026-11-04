/* Simuladores educativos: no almacenan ni transmiten datos. Version 1.0 */
(()=>{"use strict";
const COP=new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0});
const read=id=>{const el=document.getElementById(id);if(!el)return NaN;return el.value.trim()===""?NaN:Number(el.value)};
const money=v=>Number.isFinite(v)?COP.format(v):"—";
const amount=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=money(v)};
const annuity=(r,n)=>n<=0?0:Math.abs(r)<1e-12?n:Math.expm1(n*Math.log1p(r))/r;
const present=(r,n)=>n<=0?0:Math.abs(r)<1e-12?n:-Math.expm1(-n*Math.log1p(r))/r;
const okay=(v,low,high)=>Number.isFinite(v)&&v>=low&&v<=high;
function pension(){
 const age=read("age"),ret=read("ret"),years=read("years"),goal=read("goal"),expected=read("expected"),other=read("other"),saved=read("saved"),real=read("real")/100;
 const status=document.getElementById("tool-status");
 if(![okay(age,18,85),okay(ret,19,95),ret>age,okay(years,1,50),okay(goal,0,1e10),okay(expected,0,1e10),okay(other,0,1e10),okay(saved,0,1e13),okay(real,-.2,.3)].every(Boolean)){
   status.textContent="Revisa los valores: edad de retiro posterior a la actual, duración y supuestos válidos.";["gap","capital","monthly"].forEach(k=>amount(k,NaN));return;
 }
 const months=Math.round((ret-age)*12),payments=Math.round(years*12),r=Math.pow(1+real,1/12)-1;
 const gap=Math.max(0,goal-expected-other),capital=gap*present(r,payments);
 const monthly=Math.max(0,(capital-saved*Math.pow(1+r,months))/annuity(r,months));
 amount("gap",gap);amount("capital",capital);amount("monthly",monthly);
 status.textContent="Escenario hipotético en pesos constantes de hoy: "+(ret-age)+" años hasta retiro, "+years+" años de retiros, retorno real neto supuesto del "+(real*100).toFixed(1)+"% anual. El resultado no es una cotización.";
}
function education(){
 const age=read("child"),start=read("start"),years=read("degree"),cost=read("cost"),infl=read("infl")/100,rtn=read("return")/100,saved=read("initial");
 const status=document.getElementById("tool-status");
 if(![okay(age,0,25),okay(start,0,30),start>=age,okay(years,1,10),okay(cost,0,1e10),okay(infl,-.1,.45),okay(rtn,-.1,.45),okay(saved,0,1e13)].every(Boolean)){
   status.textContent="Revisa los supuestos de edad, costo y rentabilidades.";["edu-capital","edu-total","edu-monthly"].forEach(k=>amount(k,NaN));return;
 }
 const n=start-age,r=Math.pow(1+rtn,1/12)-1;
 let target=0,total=0;
 for(let y=0;y<years;y++){let price=cost*Math.pow(1+infl,n+y);total+=price;target+=price/Math.pow(1+rtn,y)}
 const months=n*12,grown=saved*Math.pow(1+r,months),monthly=months>0?Math.max(0,(target-grown)/annuity(r,months)):NaN;
 amount("edu-capital",target);amount("edu-total",total);amount("edu-monthly",monthly);
 status.textContent=months>0?"Meta estimada al inicio de estudios, antes de impuestos, variaciones de precios y mercado.":"Inicio inmediato: revisa la liquidez; no se calcula un aporte de acumulación.";
}
document.addEventListener("DOMContentLoaded",()=>{const tool=document.body.dataset.tool;if(!tool)return;const run=tool==="pension"?pension:education;document.querySelectorAll(".tool input").forEach(x=>x.addEventListener("input",run));run();});
})();