/* Formulario de contacto voluntario: desactivado hasta validación legal y backend staging. */
(()=>{
"use strict";
const config=window.TP_COMMERCIAL_CONFIG||{enabled:false,apiBase:""};
const lineNames={vida_socios:"Vida Socios",legado:"Legado",brecha_pensional:"Brecha pensional",educacion:"Educación"};
const validBase=url=>{try{const u=new URL(url);return u.protocol==="https:"||["localhost","127.0.0.1"].includes(u.hostname);}catch{return false;}};
document.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll("form[data-commercial-line]").forEach(form=>{
    const status=form.querySelector("[role=status]"),submit=form.querySelector('button[type="submit"]');
    const line=form.dataset.commercialLine;
    if(!config.enabled||!validBase(config.apiBase)){
      if(submit){submit.disabled=true;submit.textContent="Solicitud disponible tras la activación";}
      if(status)status.textContent="Esta vista es una previsualización. No se envían solicitudes ni datos personales.";
      return;
    }
    submit.disabled=false;
    submit.textContent="Solicitar conversación";
    form.addEventListener("submit",async event=>{
      event.preventDefault();
      if(!form.reportValidity())return;
      submit.disabled=true;
      if(status)status.textContent="Registrando tu solicitud…";
      const f=new FormData(form);
      const url=new URL(window.location.href);
      const body={
        requestId:form.dataset.requestId||(form.dataset.requestId=crypto.randomUUID()),
        name:String(f.get("name")||"").trim(),
        email:String(f.get("email")||"").trim(),
        phone:String(f.get("phone")||"").trim(),
        businessLine:line,
        intent:"conversation",
        consent:f.get("consent")==="yes",
        website:String(f.get("website")||""),
        attribution:{
          source:String(url.searchParams.get("utm_source")||"website"),
          medium:String(url.searchParams.get("utm_medium")||""),
          campaign:String(url.searchParams.get("utm_campaign")||""),
          content:String(url.searchParams.get("utm_content")||""),
          referrer:document.referrer||"",
          landingUrl:url.origin+url.pathname
        }
      };
      // No calculator inputs, children data, pension projections or asset values in this payload.
      try{
        const endpoint=config.apiBase.replace(/\/$/,"")+"/api/commercial/interests";
        const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        const answer=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(answer.error||"No fue posible registrar la solicitud.");
        if(status)status.textContent=answer.message||"Solicitud registrada.";
        form.reset();delete form.dataset.requestId;
      }catch(err){
        if(status)status.textContent=err.message||"No se pudo registrar. Intenta nuevamente.";
      }finally{submit.disabled=false;}
    });
  });
});
})();