import express from "express";
import {validateInterest,saveCommercialInterest} from "./commercial-core.js";

// Railway preview/production defaults to OFF. Enable only after legal and privacy review.
const WINDOW=15*60*1000,MAX=20;
const attempts=new Map();
function exceeded(key){
  const now=Date.now();
  if(attempts.size>4000)for(const [k,v] of attempts)if(now-v.since>WINDOW)attempts.delete(k);
  const item=attempts.get(key);
  if(!item||now-item.since>WINDOW){attempts.set(key,{since:now,count:1});return false;}
  item.count+=1;return item.count>MAX;
}
export function createCommercialRouter({pool,enabled=()=>process.env.ENABLE_COMMERCIAL_LEADS==="true"}){
  const router=express.Router();
  router.post("/interests",async(req,res)=>{
    if(!enabled())return res.status(503).json({ok:false,error:"La solicitud de contacto todavía no está disponible."});
    if(String(req.body?.website||"").trim())return res.status(202).json({ok:true}); // Honeypot
    if(exceeded(req.ip||req.socket?.remoteAddress||"unknown"))
      return res.status(429).json({ok:false,error:"Demasiadas solicitudes. Inténtalo más tarde."});
    const checked=validateInterest(req.body);
    if(!checked.ok)return res.status(400).json(checked);
    if(!pool)return res.status(503).json({ok:false,error:"Servicio temporalmente no disponible."});
    try{
      await saveCommercialInterest(pool,checked.lead,{defaultOwnerEmail:process.env.LEAD_DEFAULT_OWNER_EMAIL||""});
      return res.status(202).json({ok:true,message:"Recibimos tu solicitud para responderla de forma individual."});
    }catch(e){
      console.error("commercial_interest_failed",{code:String(e.code||""),type:String(e.message||"").slice(0,80)});
      return res.status(500).json({ok:false,error:"No pudimos guardar la solicitud. Inténtalo nuevamente."});
    }
  });
  return router;
}
