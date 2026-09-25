const API = "/api/crm";

const STAGES = [
  ["target","Target"],
  ["engaged","Engaged"],
  ["connected","Connected"],
  ["conversation","Conversación"],
  ["need_identified","Necesidad"],
  ["meeting_proposed","Reunión propuesta"],
  ["booked","Agendada"],
  ["showed","Asistió"],
  ["diagnostic","Diagnóstico"],
  ["proposal","Propuesta"],
  ["won","Cliente"],
  ["nurture","Nurture"],
  ["lost","Perdido"]
];

const CORE_PIPELINE = [
  "target","engaged","connected","conversation","need_identified",
  "meeting_proposed","booked","showed","diagnostic","proposal","won","nurture"
];

const state = {
  user:null,
  users:[],
  contacts:[],
  tasks:[],
  dashboard:null,
  content:[],
  linkedin:null,
  taskScope:"open"
};

const $ = (selector, root=document) => root?.querySelector(selector) || null;
const $$ = (selector, root=document) => root ? [...root.querySelectorAll(selector)] : [];
const stageLabel = (stage) => STAGES.find(([key]) => key === stage)?.[1] || stage || "—";
const fmtDate = (value, opts={}) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle:opts.dateStyle || "medium",
    ...(opts.time === false ? {} : { timeStyle:opts.timeStyle || "short" })
  }).format(date);
};
const initials = (name="") => name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase() || "TP";
const esc = (value="") => String(value).replace(/[&<>"']/g, (m)=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[m]));
const empty = (message) => '<div class="empty">' + esc(message) + '</div>';
const max = (arr) => Math.max(1,...arr.map(x=>Number(x)||0));
const touchLabel = (touch) => {
  if (!touch || typeof touch !== "object") return "—";
  const parts = [touch.source,touch.campaign,touch.content].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
};

async function api(path, options={}) {
  const config = {
    credentials:"include",
    headers:{ "Content-Type":"application/json", ...(options.headers || {}) },
    ...options
  };
  if (config.body && typeof config.body !== "string") config.body = JSON.stringify(config.body);
  const response = await fetch(API + path, config);
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const error = new Error(data.error || "Ocurrió un error.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setMessage(selector, text, ok=false) {
  const el = $(selector);
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#1D5647" : "";
}

async function init() {
  bindGlobalEvents();
  fillStageSelects();

  try {
    const me = await api("/me");
    enterApp(me.user);
    return;
  } catch (error) {
    if (error.status !== 401) console.warn(error);
  }

  const authError = new URLSearchParams(window.location.search).get("auth");
  const messages = {
    not_authorized:"Tu cuenta de Google todavía no está autorizada para entrar al CRM.",
    state:"No pudimos validar el inicio de sesión. Intenta nuevamente.",
    identity:"La identidad de Google no coincide con el usuario autorizado.",
    failed:"No pudimos completar el acceso con Google.",
    missing_code:"El acceso expiró. Intenta nuevamente."
  };
  if (authError) setMessage("#login-message", messages[authError] || "No pudimos iniciar sesión.");
}

function bindGlobalEvents() {
  $("#logout-btn")?.addEventListener("click", logout);

  $$(".nav-item").forEach(btn => btn.addEventListener("click",()=>showView(btn.dataset.view)));
  $$("[data-go]").forEach(btn => btn.addEventListener("click",()=>showView(btn.dataset.go)));

  $("#new-contact-btn")?.addEventListener("click",()=>$("#contact-dialog").showModal());
  $("#quick-task-btn")?.addEventListener("click",()=>openTaskDialog());
  $("#new-content-btn")?.addEventListener("click",()=>$("#content-dialog").showModal());
  $("#pipeline-refresh")?.addEventListener("click",loadPipeline);

  $("#contact-form")?.addEventListener("submit",createContact);
  $("#task-form")?.addEventListener("submit",createTask);
  $("#content-form")?.addEventListener("submit",createContent);
  $("#team-form")?.addEventListener("submit",createUser);

  $("#contact-search")?.addEventListener("input",debounce(loadContacts,250));
  $("#contact-stage-filter")?.addEventListener("change",loadContacts);
  $("#contact-source-filter")?.addEventListener("change",loadContacts);

  $$("[data-task-scope]").forEach(btn => btn.addEventListener("click",()=>{
    $$("[data-task-scope]").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    state.taskScope=btn.dataset.taskScope;
    loadTasks();
  }));

  $("[data-close-detail]")?.addEventListener("click",()=>$("#detail-dialog").close());
}

function fillStageSelects() {
  const options = STAGES.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join("");
  $("#new-contact-stage").innerHTML = options;
  $("#contact-stage-filter").insertAdjacentHTML("beforeend", options);
}

async function logout() {
  try { await api("/auth/logout",{method:"POST"}); } catch {}
  window.location.assign("/crm/");
}

function enterApp(user) {
  state.user=user;
  $("#auth-shell").hidden=true;
  $("#app-shell").hidden=false;
  $("#user-name").textContent=user.name;
  $("#user-role").textContent=user.role === "admin" ? "Administrador" : user.role === "viewer" ? "Solo lectura" : "Miembro";
  $("#user-avatar").textContent=initials(user.name);
  $("#team-create-panel").hidden=user.role !== "admin";
  applyPermissions();
  loadUsers();
  showView("dashboard");
}

function applyPermissions() {
  const readOnly=state.user?.role==="viewer";
  ["#new-contact-btn","#quick-task-btn","#new-content-btn"].forEach(selector=>{
    const el=$(selector);
    if(el) el.hidden=readOnly;
  });
}

const viewMeta = {
  dashboard:["OPERACIÓN COMERCIAL","Inicio"],
  pipeline:["FUNNEL","Pipeline"],
  linkedin:["PROSPECCIÓN","LinkedIn"],
  contacts:["RELACIONES","Contactos"],
  tasks:["SEGUIMIENTO","Tareas"],
  content:["ATRIBUCIÓN","Contenido"],
  team:["ACCESOS","Equipo"]
};

async function showView(name) {
  $$(".nav-item").forEach(btn=>btn.classList.toggle("active",btn.dataset.view===name));
  $$(".view").forEach(view=>view.classList.toggle("active-view",view.id==="view-"+name));
  $("#view-kicker").textContent=viewMeta[name]?.[0] || "";
  $("#view-title").textContent=viewMeta[name]?.[1] || name;

  if (name==="dashboard") await loadDashboard();
  if (name==="pipeline") await loadPipeline();
  if (name==="linkedin") await loadLinkedIn();
  if (name==="contacts") await loadContacts();
  if (name==="tasks") await loadTasks();
  if (name==="content") await loadContent();
  if (name==="team") await loadUsers();
}

async function loadUsers() {
  try {
    const data = await api("/users");
    state.users=data.users || [];
    renderTeam();
    populateTaskContacts();
  } catch (error) {
    console.warn(error);
  }
}

async function loadDashboard() {
  try {
    const [dashboard,tasks,linkedin] = await Promise.all([
      api("/dashboard"),
      api("/tasks?scope=today&mine=1"),
      api("/linkedin/today")
    ]);
    state.dashboard=dashboard;
    state.linkedin=linkedin;
    renderDashboard(dashboard,tasks.tasks || [],linkedin);
  } catch (error) {
    $("#dashboard-cards").innerHTML=empty(error.message);
  }
}

function renderDashboard(data,tasks,linkedin={}) {
  const counts=Object.fromEntries((data.stages || []).map(x=>[x.stage,Number(x.count)]));
  const active = ["conversation","need_identified","meeting_proposed"].reduce((n,k)=>n+(counts[k]||0),0);
  const cards = [
    { label:"Conversaciones activas",value:active,sub:"Relaciones con contexto",go:"pipeline",tone:active>0?"positive":"" },
    { label:"Citas próximos 7 días",value:Number(data.meetings?.upcoming||0),sub:"Agenda confirmada",go:"pipeline",tone:"" },
    { label:"Tareas para hoy",value:Number(data.tasks?.due_today||0),sub:"Próximas acciones",go:"tasks",tone:Number(data.tasks?.due_today||0)>0?"focus":"" },
    { label:"Tareas vencidas",value:Number(data.tasks?.overdue||0),sub:"Requieren atención",go:"tasks",tone:Number(data.tasks?.overdue||0)>0?"warning":"" }
  ];
  $("#dashboard-cards").innerHTML=cards.map(card=>
    '<button class="metric-card metric-card-button '+esc(card.tone)+'" type="button" data-dashboard-go="'+esc(card.go)+'">'+
      '<small>'+esc(card.label)+'</small><strong>'+card.value+'</strong><em>'+esc(card.sub)+'</em>'+
      '<span class="metric-arrow">→</span>'+
    '</button>'
  ).join("");

  const liStats=linkedin?.stats||{};
  const liPolicy=linkedin?.policy||{};
  if ($("#linkedin-invites-today")) $("#linkedin-invites-today").textContent=Number(liStats.invites_today||0)+"/"+Number(liPolicy.dailyTarget||5);
  if ($("#linkedin-pending")) $("#linkedin-pending").textContent=Number(liStats.pending||0);
  if ($("#linkedin-stale")) {
    const stale=Number(liStats.stale_pending||0);
    $("#linkedin-stale").textContent=stale+" con más de "+Number(liPolicy.staleDays||14)+" días";
  }
  if ($("#linkedin-acceptance")) $("#linkedin-acceptance").textContent=Number(liStats.acceptance_rate||0).toFixed(1).replace(".0","")+"%";
  if ($("#linkedin-conversations")) $("#linkedin-conversations").textContent=Number(liStats.conversations_or_beyond||0);

  $$("[data-go]",$("#view-dashboard")).forEach(btn=>btn.addEventListener("click",()=>showView(btn.dataset.go)));

  const funnelStages = ["connected","conversation","need_identified","booked","diagnostic","proposal","won"];
  const maxCount=max(funnelStages.map(k=>counts[k]||0));
  $("#dashboard-funnel").innerHTML=funnelStages.map(key=>{
    const value=counts[key]||0;
    return '<div class="funnel-row"><label>'+esc(stageLabel(key))+'</label><div class="funnel-track"><i style="width:'+Math.max(3,(value/maxCount)*100)+'%"></i></div><strong>'+value+'</strong></div>';
  }).join("") || empty("Aún no hay datos.");

  $("#dashboard-tasks").innerHTML=(tasks.length ? tasks.slice(0,6).map(task=>taskStack(task)).join("") : empty("No tienes acciones pendientes hoy."));
  bindTaskActions($("#dashboard-tasks"));
  bindLinkedInActions($("#dashboard-tasks"));

  const sourceMax=max((data.sources||[]).map(x=>x.count));
  $("#dashboard-sources").innerHTML=(data.sources||[]).length
    ? data.sources.map(row=>'<div class="bar-row"><label>'+esc(row.source_channel)+'</label><div class="bar-track"><i style="width:'+Math.max(4,(Number(row.count)/sourceMax)*100)+'%"></i></div><strong>'+row.count+'</strong></div>').join("")
    : empty("Aún no hay leads registrados.");

  $("#dashboard-content").innerHTML=(data.content||[]).length
    ? data.content.map(item=>'<div class="stack-item"><span class="stack-icon">◇</span><div class="stack-main"><strong>'+esc(item.title)+'</strong><small>'+esc(item.profile)+' · '+esc(item.tracking_code)+'</small></div><strong>'+item.contacts+'</strong></div>').join("")
    : empty("Registra contenido para medir qué piezas generan relaciones.");
}

async function loadContacts() {
  const params=new URLSearchParams();
  const q=$("#contact-search")?.value.trim();
  const stage=$("#contact-stage-filter")?.value;
  const source=$("#contact-source-filter")?.value;
  if(q) params.set("q",q);
  if(stage) params.set("stage",stage);
  if(source) params.set("source",source);

  try {
    const data=await api("/contacts?"+params.toString());
    state.contacts=data.contacts||[];
    renderContactsTable();
    populateTaskContacts();
  } catch (error) {
    $("#contacts-table").innerHTML='<tr><td colspan="6">'+esc(error.message)+'</td></tr>';
  }
}

function renderContactsTable() {
  const body=$("#contacts-table");
  body.innerHTML=state.contacts.length ? state.contacts.map(contact=>
    '<tr data-contact-id="'+contact.id+'">'+
      '<td><div class="contact-cell"><strong>'+esc(contact.name)+'</strong><small>'+esc([contact.title,contact.company].filter(Boolean).join(" · ") || "Sin empresa/cargo")+'</small></div></td>'+
      '<td><span class="stage-badge">'+(contact.target_score ?? "—")+'</span></td>'+
      '<td><span class="stage-badge">'+esc(stageLabel(contact.stage))+'</span></td>'+
      '<td>'+esc(contact.source_channel || "—")+(contact.source_profile ? '<br><small class="muted">'+esc(contact.source_profile)+'</small>' : '')+'</td>'+
      '<td>'+esc(contact.owner_name || "Sin asignar")+'</td>'+
      '<td>'+esc(contact.next_action_at ? fmtDate(contact.next_action_at) : "—")+'</td>'+
    '</tr>'
  ).join("") : '<tr><td colspan="6">'+empty("No encontramos contactos.")+'</td></tr>';

  $$("[data-contact-id]",body).forEach(row=>row.addEventListener("click",()=>openContact(row.dataset.contactId)));
}

async function createContact(event) {
  event.preventDefault();
  const submitter=event.submitter;
  if (submitter?.value==="cancel") return;
  const form=new FormData(event.currentTarget);
  const body=Object.fromEntries(form.entries());
  try {
    const data=await api("/contacts",{method:"POST",body});
    event.currentTarget.reset();
    $("#contact-dialog").close();
    await loadUsers();
    await loadContacts();
    await openContact(data.id);
  } catch (error) {
    setMessage("#contact-message",error.message);
  }
}

async function openContact(id) {
  try {
    const data=await api("/contacts/"+id);
    const c=data.contact;
    $("#detail-name").textContent=c.name;
    $("#detail-body").innerHTML=renderContactDetail(data);
    if (!$("#detail-dialog").open) $("#detail-dialog").showModal();
    bindContactDetail(data);
  } catch (error) {
    alert(error.message);
  }
}

function renderContactDetail(data) {
  const c=data.contact;
  const ownerOptions=state.users.filter(u=>u.active).map(u=>'<option value="'+u.id+'" '+(u.id===c.owner_user_id?"selected":"")+'>'+esc(u.name)+'</option>').join("");
  const stageOptions=STAGES.map(([key,label])=>'<option value="'+key+'" '+(key===c.stage?"selected":"")+'>'+label+'</option>').join("");
  const timeline=(data.activities||[]).length
    ? data.activities.map(a=>'<div class="timeline-item"><strong>'+esc(a.summary)+'</strong><small>'+esc(a.type)+' · '+fmtDate(a.occurred_at)+(a.created_by_name?' · '+esc(a.created_by_name):'')+'</small></div>').join("")
    : empty("Sin actividad todavía.");
  const appointments=(data.appointments||[]).length
    ? data.appointments.map(a=>'<div class="stack-item"><span class="stack-icon">◷</span><div class="stack-main"><strong>'+esc(a.topic||"Reunión Tres Pilares")+'</strong><small>'+fmtDate(a.start_time)+' · '+esc(a.assigned_member_name||"")+'</small></div></div>').join("")
    : empty("No hay reuniones asociadas.");
  const generatedDrafts=buildLinkedInDrafts(c);
  const storedDrafts={
    invite:c.linkedin_invite_note || generatedDrafts.invite,
    firstDm:c.linkedin_first_dm_draft || generatedDrafts.firstDm,
    follow1:c.linkedin_followup_1_draft || generatedDrafts.follow1,
    follow2:c.linkedin_followup_2_draft || generatedDrafts.follow2
  };
  const stageDraft=linkedinStageDraft(c,storedDrafts);
  const commentDraft=c.linkedin_comment_draft || generatedDrafts.comment || "";
  const linkedinPrimary=linkedinNextAction(c);

  return '<div class="detail-grid">'+
    '<div class="detail-card">'+
      '<div class="detail-facts">'+
        '<div class="fact"><small>Empresa</small><strong>'+esc(c.company||"—")+'</strong></div>'+
        '<div class="fact"><small>Cargo</small><strong>'+esc(c.title||"—")+'</strong></div>'+
        '<div class="fact"><small>Segmento</small><strong>'+esc(c.segment||"—")+'</strong></div>'+
        '<div class="fact"><small>Score de prospección</small><strong>'+esc(c.target_score ?? "—")+'/100</strong></div>'+
        '<div class="fact"><small>Origen CRM</small><strong>'+esc(c.source_channel||"—")+(c.source_profile?' · '+esc(c.source_profile):'')+'</strong></div>'+
        '<div class="fact"><small>Primer touch</small><strong>'+esc(touchLabel(c.first_touch))+'</strong></div>'+
        '<div class="fact"><small>Último touch</small><strong>'+esc(touchLabel(c.last_touch))+'</strong></div>'+
        '<div class="fact"><small>Criterio</small><strong>'+esc(c.score_reason||"—")+'</strong></div>'+
        '<div class="fact"><small>Último contacto</small><strong>'+esc(c.last_contact_at?fmtDate(c.last_contact_at):"—")+'</strong></div>'+
        '<div class="fact"><small>Próxima acción</small><strong>'+esc(c.next_action_at?fmtDate(c.next_action_at):"—")+'</strong></div>'+
        (c.source_channel==="linkedin"?'<div class="fact"><small>Invitación LinkedIn</small><strong>'+esc(c.linkedin_invited_at?fmtDate(c.linkedin_invited_at):"—")+'</strong></div>':'')+
        (c.source_channel==="linkedin"?'<div class="fact"><small>Conexión LinkedIn</small><strong>'+esc(c.linkedin_connected_at?fmtDate(c.linkedin_connected_at):"—")+'</strong></div>':'')+
        (c.source_channel==="linkedin"?'<div class="fact"><small>Primer DM</small><strong>'+esc(c.linkedin_first_dm_at?fmtDate(c.linkedin_first_dm_at):"—")+'</strong></div>':'')+
        (c.source_channel==="linkedin"?'<div class="fact"><small>Última respuesta</small><strong>'+esc(c.linkedin_last_reply_at?fmtDate(c.linkedin_last_reply_at):"—")+'</strong></div>':'')+
      '</div>'+
      '<hr style="border:0;border-top:1px solid #eee8df;margin:18px 0">'+
      '<div class="form-grid two">'+
        '<label>Etapa<select id="detail-stage">'+stageOptions+'</select></label>'+
        '<label>Owner<select id="detail-owner"><option value="">Sin asignar</option>'+ownerOptions+'</select></label>'+
        '<label class="span-2">Señal / contexto<textarea id="detail-signal" rows="2">'+esc(c.signal||"")+'</textarea></label>'+
        '<label class="span-2">Necesidad detectada<textarea id="detail-need" rows="3">'+esc(c.need_summary||"")+'</textarea></label>'+
      '</div>'+
      '<div class="modal-actions"><button class="btn ghost" id="archive-contact">Archivar</button><button class="btn primary" id="save-contact">Guardar cambios</button></div>'+
    '</div>'+
    '<div style="display:grid;gap:18px">'+
      (c.source_channel==="linkedin"?'<div class="detail-card linkedin-message-center">'+
        '<div class="panel-head"><div><span class="eyebrow">LINKEDIN</span><h3>Centro de mensajes</h3></div>'+
          '<div class="stack-actions">'+
            (c.linkedin_url?'<a class="stack-action" href="'+esc(c.linkedin_url)+'" target="_blank" rel="noopener">Abrir perfil</a>':'')+
            (linkedinPrimary?'<button class="stack-action emphasis" type="button" data-linkedin-action="'+linkedinPrimary.action+'" data-contact-id="'+c.id+'">'+esc(linkedinPrimary.label)+'</button>':'')+
            (c.stage==="connected"?'<button class="stack-action" type="button" data-linkedin-action="reply_received" data-contact-id="'+c.id+'">Respondió</button>':'')+
          '</div>'+
        '</div>'+
        '<p class="draft-note">El CRM muestra únicamente el mensaje que corresponde a la etapa actual. Revísalo antes de enviar.</p>'+
        (stageDraft?.status
          ? '<div class="stage-message-hint">'+esc(stageDraft.status)+'</div>'
          : '<div class="draft-block stage-draft"><div class="draft-head"><strong>'+esc(stageDraft?.title||"Mensaje")+'</strong>'+
              (stageDraft?.maxLength?'<small id="stage-draft-count">'+String(stageDraft.value||"").length+'/'+stageDraft.maxLength+'</small>':(stageDraft?.meta?'<small>'+esc(stageDraft.meta)+'</small>':''))+
            '</div>'+
            '<textarea id="'+esc(stageDraft?.id||"linkedin-stage-draft")+'" rows="5" '+(stageDraft?.maxLength?'maxlength="'+stageDraft.maxLength+'"':'')+'>'+esc(stageDraft?.value||"")+'</textarea>'+
            '<button class="text-action" type="button" data-copy-draft="'+esc(stageDraft?.id||"linkedin-stage-draft")+'">'+esc(stageDraft?.copy||"Copiar mensaje")+'</button></div>')+
        '<div class="draft-block"><div class="draft-head"><strong>Comentario</strong><small>Escribe o ajusta antes de publicar</small></div>'+
          '<textarea id="linkedin-comment-draft" rows="4" placeholder="Escribe aquí el comentario para esta publicación…">'+esc(commentDraft)+'</textarea>'+
          '<button class="text-action" type="button" data-copy-draft="linkedin-comment-draft">Copiar comentario</button></div>'+
        '<div class="modal-actions draft-actions"><button class="btn ghost" type="button" id="regenerate-linkedin-drafts">Regenerar base</button><button class="btn primary" type="button" id="save-linkedin-drafts">Guardar borradores</button></div>'+
      '</div>':'')+
      '<div class="detail-card interaction-card"><div class="panel-head"><div><span class="eyebrow">ACCIÓN RÁPIDA</span><h3>Registrar interacción</h3></div><span class="stage-badge">'+esc(stageLabel(c.stage))+'</span></div>'+
        (c.source_channel==="linkedin"
          ? linkedinQuickButtons(c)
          : '<div class="empty compact">Las acciones rápidas se muestran para prospectos de LinkedIn.</div>')+
        '<details class="manual-interaction"><summary>Registrar otra interacción</summary><form id="activity-form" class="form-grid">'+
          '<label>Tipo<select name="type"><option value="linkedin_dm">DM LinkedIn</option><option value="linkedin_comment">Comentario LinkedIn</option><option value="linkedin_connection">Conexión LinkedIn</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="call">Llamada</option><option value="meeting">Reunión</option><option value="note">Nota</option></select></label>'+
          '<label>Resumen<textarea name="summary" rows="2" required></textarea></label>'+
          '<button class="btn ghost" type="submit">Registrar manualmente</button></form></details></div>'+
      '<div class="detail-card"><h3>Reuniones</h3>'+appointments+'</div>'+
    '</div>'+
  '</div>'+
  '<div class="detail-card" style="margin-top:18px"><h3>Historial</h3><div class="timeline">'+timeline+'</div></div>';
}

function bindContactDetail(data) {
  const id=data.contact.id;
  const generatedDrafts=buildLinkedInDrafts(data.contact);
  const storedDrafts={
    invite:data.contact.linkedin_invite_note || generatedDrafts.invite,
    firstDm:data.contact.linkedin_first_dm_draft || generatedDrafts.firstDm,
    follow1:data.contact.linkedin_followup_1_draft || generatedDrafts.follow1,
    follow2:data.contact.linkedin_followup_2_draft || generatedDrafts.follow2
  };
  const stageDraft=linkedinStageDraft(data.contact,storedDrafts);
  $("#save-contact")?.addEventListener("click",async()=>{
    try {
      await api("/contacts/"+id,{
        method:"PATCH",
        body:{
          stage:$("#detail-stage").value,
          ownerUserId:$("#detail-owner").value || "",
          signal:$("#detail-signal").value,
          needSummary:$("#detail-need").value
        }
      });
      $("#detail-dialog").close();
      await Promise.all([loadDashboard(),loadContacts()]);
    } catch(error){ alert(error.message); }
  });

  $("#archive-contact")?.addEventListener("click",async()=>{
    if(!confirm("¿Archivar este contacto?")) return;
    try {
      await api("/contacts/"+id+"/archive",{method:"POST"});
      $("#detail-dialog").close();
      await loadContacts();
    } catch(error){ alert(error.message); }
  });

  const stageTextarea=stageDraft?.id ? $("#"+stageDraft.id) : null;
  stageTextarea?.addEventListener("input",()=>{
    const counter=$("#stage-draft-count");
    if(counter && stageDraft?.maxLength) counter.textContent=stageTextarea.value.length+"/"+stageDraft.maxLength;
  });

  $$("[data-copy-draft]").forEach(btn=>btn.addEventListener("click",async()=>{
    const field=$("#"+btn.dataset.copyDraft);
    if(!field) return;
    await navigator.clipboard.writeText(field.value);
    const old=btn.textContent;
    btn.textContent="Copiado";
    setTimeout(()=>{ if(btn.isConnected) btn.textContent=old; },1200);
  }));

  $("#regenerate-linkedin-drafts")?.addEventListener("click",()=>{
    const drafts=buildLinkedInDrafts(data.contact);
    const freshStage=linkedinStageDraft(data.contact,drafts);
    if (freshStage?.id) {
      const el=$("#"+freshStage.id);
      if(el) el.value=freshStage.value || "";
      const counter=$("#stage-draft-count");
      if(counter && freshStage.maxLength) counter.textContent=(freshStage.value||"").length+"/"+freshStage.maxLength;
    }
    const comment=$("#linkedin-comment-draft");
    if(comment) comment.value=drafts.comment || "";
  });

  $("#save-linkedin-drafts")?.addEventListener("click",async()=>{
    try {
      await api("/contacts/"+id,{
        method:"PATCH",
        body:{
          ...(stageDraft?.id==="linkedin-invite-draft" ? { linkedinInviteNote:$("#linkedin-invite-draft")?.value || "" } : {}),
          ...(stageDraft?.id==="linkedin-first-dm-draft" ? { linkedinFirstDmDraft:$("#linkedin-first-dm-draft")?.value || "" } : {}),
          ...(stageDraft?.id==="linkedin-followup-1-draft" ? { linkedinFollowup1Draft:$("#linkedin-followup-1-draft")?.value || "" } : {}),
          ...(stageDraft?.id==="linkedin-followup-2-draft" ? { linkedinFollowup2Draft:$("#linkedin-followup-2-draft")?.value || "" } : {}),
          linkedinCommentDraft:$("#linkedin-comment-draft")?.value || ""
        }
      });
      const btn=$("#save-linkedin-drafts");
      if(btn){
        const old=btn.textContent;
        btn.textContent="Guardado";
        setTimeout(()=>{ if(btn.isConnected) btn.textContent=old; },1200);
      }
    } catch(error){ alert(error.message); }
  });

  bindLinkedInActions($("#detail-body"));
  bindCrmStageActions($("#detail-body"));

  $("#activity-form")?.addEventListener("submit",async(event)=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    try {
      await api("/contacts/"+id+"/activities",{
        method:"POST",
        body:{ type:form.get("type"), direction:"outbound", summary:form.get("summary") }
      });
      await openContact(id);
    } catch(error){ alert(error.message); }
  });
}

async function loadPipeline() {
  try {
    const data=await api("/contacts");
    state.contacts=data.contacts||[];
    renderPipeline();
    populateTaskContacts();
  } catch (error) {
    $("#pipeline-board").innerHTML=empty(error.message);
  }
}

function renderPipeline() {
  const board=$("#pipeline-board");
  board.innerHTML=CORE_PIPELINE.map(stage=>{
    const contacts=state.contacts.filter(c=>c.stage===stage);
    return '<section class="kanban-col" data-stage="'+stage+'">'+
      '<div class="kanban-head"><strong>'+esc(stageLabel(stage))+'</strong><span>'+contacts.length+'</span></div>'+
      '<div class="kanban-cards">'+(contacts.map(c=>
        '<article class="lead-card" draggable="true" data-id="'+c.id+'">'+
          '<strong>'+esc(c.name)+'</strong>'+
          '<small>'+esc([c.title,c.company].filter(Boolean).join(" · ") || c.segment || "Sin contexto")+'</small>'+
          '<div class="lead-meta">'+
            (c.source_channel?'<span class="pill">'+esc(c.source_channel)+'</span>':'')+
            (c.target_score!=null?'<span class="pill">Score '+esc(c.target_score)+'</span>':'')+
            (c.signal?'<span class="pill gold" title="'+esc(c.signal)+'">señal</span>':'')+
          '</div>'+
        '</article>'
      ).join("") || '<div class="empty">Sin contactos</div>')+'</div>'+
    '</section>';
  }).join("");

  $$(".lead-card",board).forEach(card=>{
    card.addEventListener("dragstart",()=>{
      card.classList.add("dragging");
      card.dataset.dragging="1";
    });
    card.addEventListener("dragend",()=>{
      card.classList.remove("dragging");
      delete card.dataset.dragging;
    });
    card.addEventListener("click",()=>openContact(card.dataset.id));
  });

  $$(".kanban-col",board).forEach(col=>{
    col.addEventListener("dragover",(event)=>{ event.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave",()=>col.classList.remove("drag-over"));
    col.addEventListener("drop",async(event)=>{
      event.preventDefault();
      col.classList.remove("drag-over");
      const card=$(".lead-card.dragging",board);
      if(!card) return;
      try {
        await api("/contacts/"+card.dataset.id,{method:"PATCH",body:{stage:col.dataset.stage}});
        await loadPipeline();
      } catch(error){ alert(error.message); }
    });
  });
}

async function loadTasks() {
  try {
    const data=await api("/tasks?scope="+encodeURIComponent(state.taskScope));
    state.tasks=data.tasks||[];
    renderTasks();
  } catch(error){
    $("#tasks-list").innerHTML=empty(error.message);
  }
}

function taskStack(task) {
  const action=task.type?.startsWith("linkedin") ? linkedinTaskAction(task) : null;
  return '<div class="stack-item">'+
    '<span class="stack-icon">'+(task.type?.startsWith("linkedin")?"in":"✓")+'</span>'+
    '<div class="stack-main"><strong>'+esc(task.title)+'</strong><small>'+esc(task.contact_name||"Sin contacto")+' · '+fmtDate(task.due_at)+'</small></div>'+
    '<div class="stack-actions">'+
      (task.linkedin_url?'<a class="stack-action" href="'+esc(task.linkedin_url)+'" target="_blank" rel="noopener">Abrir</a>':'')+
      (action?'<button class="stack-action emphasis" data-linkedin-action="'+action.action+'" data-contact-id="'+esc(task.contact_id||"")+'">'+esc(action.label)+'</button>':'<button class="stack-action" data-complete-task="'+task.id+'">Hecho</button>')+
    '</div>'+
  '</div>';
}

function renderTasks() {
  $("#tasks-list").innerHTML=state.tasks.length ? state.tasks.map(task=>{
    const action=task.type?.startsWith("linkedin") ? linkedinTaskAction(task) : null;
    return '<div class="task-row">'+
      (action
        ? '<button class="task-check" data-linkedin-action="'+action.action+'" data-contact-id="'+esc(task.contact_id||"")+'" title="'+esc(action.label)+'">in</button>'
        : '<button class="task-check '+(task.status==="done"?"done":"")+'" data-complete-task="'+task.id+'">'+(task.status==="done"?"✓":"")+'</button>')+
      '<div><strong>'+esc(task.title)+'</strong><small>'+esc(task.contact_name||"Sin contacto")+(task.company?' · '+esc(task.company):'')+'</small></div>'+
      '<div class="task-meta-hide"><small>Tipo</small><strong>'+esc(task.type)+'</strong></div>'+
      '<div class="task-meta-hide"><small>Cuándo</small><strong>'+fmtDate(task.due_at)+'</strong></div>'+
      '<button class="text-action" data-open-contact="'+esc(task.contact_id||"")+'">Abrir</button>'+
    '</div>';
  }).join("") : empty("No hay tareas en esta vista.");
  bindTaskActions($("#tasks-list"));
  bindLinkedInActions($("#tasks-list"));
}

function bindTaskActions(root=document) {
  $$("[data-complete-task]",root).forEach(btn=>btn.addEventListener("click",async()=>{
    try {
      await api("/tasks/"+btn.dataset.completeTask,{method:"PATCH",body:{status:"done"}});
      if ($("#view-tasks").classList.contains("active-view")) await loadTasks();
      if ($("#view-linkedin").classList.contains("active-view")) await loadLinkedIn();
      if ($("#view-dashboard").classList.contains("active-view")) await loadDashboard();
    } catch(error){ alert(error.message); }
  }));
  $$("[data-open-contact]",root).forEach(btn=>btn.addEventListener("click",()=>{
    if(btn.dataset.openContact) openContact(btn.dataset.openContact);
  }));
}

function openTaskDialog(contactId="") {
  populateTaskContacts();
  $("#task-form").reset();
  $("#task-contact").value=contactId || "";
  const due=new Date(Date.now()+24*60*60*1000);
  due.setMinutes(Math.ceil(due.getMinutes()/15)*15,0,0);
  const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16);
  $("#task-form [name=dueAt]").value=local;
  $("#task-dialog").showModal();
}

function populateTaskContacts() {
  const select=$("#task-contact");
  if(!select) return;
  const current=select.value;
  const contacts=state.contacts.length?state.contacts:[];
  select.innerHTML='<option value="">Sin contacto</option>'+contacts.map(c=>'<option value="'+c.id+'">'+esc(c.name)+(c.company?' · '+esc(c.company):'')+'</option>').join("");
  if(current) select.value=current;
}

async function createTask(event) {
  event.preventDefault();
  if(event.submitter?.value==="cancel") return;
  const form=new FormData(event.currentTarget);
  try {
    await api("/tasks",{
      method:"POST",
      body:{
        contactId:form.get("contactId") || null,
        type:form.get("type"),
        title:form.get("title"),
        dueAt:new Date(form.get("dueAt")).toISOString(),
        priority:form.get("priority"),
        notes:form.get("notes")
      }
    });
    event.currentTarget.reset();
    $("#task-dialog").close();
    if($("#view-tasks").classList.contains("active-view")) await loadTasks();
    if($("#view-linkedin").classList.contains("active-view")) await loadLinkedIn();
  } catch(error){ setMessage("#task-message",error.message); }
}

async function loadLinkedIn() {
  try {
    const [linkedin,contacts]=await Promise.all([api("/linkedin/today"),api("/contacts?source=linkedin")]);
    state.linkedin=linkedin;
    state.contacts=contacts.contacts||state.contacts;
    renderLinkedIn();
    populateTaskContacts();
  } catch(error){
    $("#linkedin-tasks").innerHTML=empty(error.message);
  }
}

function firstName(name="") {
  return String(name).trim().split(/\s+/)[0] || "";
}

function compactSignal(signal="", max=120) {
  const clean=String(signal||"").replace(/\s+/g," ").trim();
  if (!clean) return "";
  return clean.length<=max ? clean : clean.slice(0,max-1).trim()+"…";
}

function buildLinkedInDrafts(contact) {
  const name=firstName(contact?.name);
  const company=String(contact?.company||"").trim();
  const title=String(contact?.title||"").trim();
  const rawSignal=compactSignal(contact?.signal||"",105);
  const internalSignal=/encaje|score|perfil emprendedor|sin una señal|prioridad|\bicp\b/i.test(rawSignal);
  const activitySignal=/post|publicaci[oó]n|comparti[oó]|escribi[oó]|coment[oó]|evento|certificaci[oó]n|lanzamiento|ascenso|nuevo rol/i.test(rawSignal);
  const signal=rawSignal && activitySignal && !internalSignal ? rawSignal : "";
  const who=[title,company].filter(Boolean).join(" en ");
  const reference=signal ? "Vi "+signal.charAt(0).toLowerCase()+signal.slice(1) : (who ? "Me llamó la atención tu trabajo como "+who : "Me pareció interesante tu perfil");

  let invite=(name ? "Hola "+name+", " : "")+reference+". Trabajo en finanzas y planificación patrimonial. Me gustaría conectar.";
  if (invite.length>200) {
    invite=(name ? "Hola "+name+", " : "")+reference+". También trabajo en finanzas y negocios. Me gustaría conectar.";
  }
  if (invite.length>200) invite=invite.slice(0,197).trim()+"...";

  const firstDm=(name ? "Gracias por conectar, "+name+". " : "")+
    (signal ? "Me quedó sonando el punto sobre "+signal.toLowerCase()+". " : "Me llamó la atención tu trayectoria"+(company?" en "+company:"")+". ")+
    "Desde finanzas y construcción de patrimonio sigo mucho cómo profesionales y empresarios ordenan decisiones que suelen quedar aisladas. ¿En qué estás más enfocado actualmente?";

  const follow1=(name ? name+", " : "")+
    "retomando esto, una cosa que vemos mucho es que inversión, liquidez y protección terminan tratándose por separado. Cuando se ordenan por objetivos y horizonte, cambia bastante la conversación. ¿Eso hoy lo tienes estructurado o todavía está disperso?";

  const follow2=(name ? name+", " : "")+
    "cierro el loop por aquí para no llenarte de mensajes. Si más adelante te sirve contrastar cómo estás ordenando protección, capital y objetivos de largo plazo, con gusto conversamos. Un abrazo.";

  const comment=signal
    ? "Buen punto. Me parece interesante especialmente "+signal.charAt(0).toLowerCase()+signal.slice(1)+". Hay una conversación valiosa ahí sobre cómo una decisión operativa termina impactando la estructura financiera y el horizonte de largo plazo."
    : "";

  return { invite,firstDm,follow1,follow2,comment };
}

function linkedinStageDraft(contact,drafts) {
  if (!contact) return null;
  if (contact.stage === "target") {
    return { id:"linkedin-invite-draft", title:"Nota de conexión", value:drafts.invite, copy:"Copiar nota", maxLength:200 };
  }
  if (contact.stage === "engaged") {
    if (!contact.linkedin_invited_at) {
      return { id:"linkedin-invite-draft", title:"Nota de conexión", value:drafts.invite, copy:"Copiar nota", maxLength:200 };
    }
    return { status:"Invitación enviada. Espera a que acepte antes de enviar un DM." };
  }
  if (contact.stage === "connected") {
    if (!contact.linkedin_first_dm_at) {
      return { id:"linkedin-first-dm-draft", title:"Primer DM", value:drafts.firstDm, copy:"Copiar DM" };
    }
    if (!contact.linkedin_followup_1_at) {
      return { id:"linkedin-followup-1-draft", title:"Follow-up #1", value:drafts.follow1, copy:"Copiar follow-up", meta:"+4 días" };
    }
    if (!contact.linkedin_followup_2_at) {
      return { id:"linkedin-followup-2-draft", title:"Follow-up #2", value:drafts.follow2, copy:"Copiar cierre", meta:"cierre" };
    }
    return { status:"La secuencia de outreach ya quedó completa. Espera respuesta o mueve el prospecto a nurture." };
  }
  if (contact.stage === "conversation") {
    return { status:"Ya hay conversación. Responde usando el contexto real del hilo; evita un mensaje automático genérico." };
  }
  if (contact.stage === "need_identified") {
    return { status:"La necesidad ya está identificada. El siguiente mensaje debe profundizar o abrir la puerta a una reunión, según el contexto de la conversación." };
  }
  if (contact.stage === "meeting_proposed") {
    return { status:"La reunión ya fue propuesta. Usa este espacio principalmente para comentarios o seguimiento contextual." };
  }
  if (contact.stage === "nurture") {
    return { status:"Prospecto en nurture. Prioriza una nueva interacción con contexto antes de reabrir conversación." };
  }
  return { status:"No hay un borrador automático definido para esta etapa." };
}

function linkedinNextAction(item) {
  if (!item) return null;
  if (item.stage === "target") return { action:"invite_sent",label:"Invitación enviada" };
  if (item.stage === "engaged") {
    return item.linkedin_invited_at
      ? { action:"accepted",label:"Aceptó" }
      : { action:"invite_sent",label:"Invitación enviada" };
  }
  if (item.stage === "connected") {
    if (!item.linkedin_first_dm_at) return { action:"first_dm_sent",label:"DM enviado" };
    if (!item.linkedin_followup_1_at) return { action:"followup_1_sent",label:"Follow-up #1" };
    if (!item.linkedin_followup_2_at) return { action:"followup_2_sent",label:"Follow-up #2" };
  }
  return null;
}

function linkedinQuickButtons(contact) {
  if (!contact || contact.source_channel !== "linkedin") return "";
  const id=contact.id;
  const buttons=[];

  if (contact.stage === "target") {
    buttons.push(
      '<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Comenté</button>',
      '<button class="interaction-btn primary" type="button" data-linkedin-action="invite_sent" data-contact-id="'+id+'">Invitación enviada</button>'
    );
  } else if (contact.stage === "engaged") {
    buttons.push('<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Comenté</button>');
    if (contact.linkedin_invited_at) {
      buttons.push('<button class="interaction-btn primary" type="button" data-linkedin-action="accepted" data-contact-id="'+id+'">Aceptó conexión</button>');
    } else {
      buttons.push('<button class="interaction-btn primary" type="button" data-linkedin-action="invite_sent" data-contact-id="'+id+'">Invitación enviada</button>');
    }
  } else if (contact.stage === "connected") {
    if (!contact.linkedin_first_dm_at) {
      buttons.push('<button class="interaction-btn primary" type="button" data-linkedin-action="first_dm_sent" data-contact-id="'+id+'">Primer DM enviado</button>');
    } else if (!contact.linkedin_followup_1_at) {
      buttons.push('<button class="interaction-btn" type="button" data-linkedin-action="followup_1_sent" data-contact-id="'+id+'">Follow-up #1 enviado</button>');
    } else if (!contact.linkedin_followup_2_at) {
      buttons.push('<button class="interaction-btn" type="button" data-linkedin-action="followup_2_sent" data-contact-id="'+id+'">Follow-up #2 enviado</button>');
    }
    buttons.push('<button class="interaction-btn success" type="button" data-linkedin-action="reply_received" data-contact-id="'+id+'">Respondió</button>');
  } else if (contact.stage === "conversation") {
    buttons.push(
      '<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Comenté</button>',
      '<button class="interaction-btn success" type="button" data-crm-stage="need_identified" data-contact-id="'+id+'">Necesidad identificada</button>'
    );
  } else if (contact.stage === "need_identified") {
    buttons.push(
      '<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Comenté</button>',
      '<button class="interaction-btn success" type="button" data-crm-stage="meeting_proposed" data-contact-id="'+id+'">Proponer reunión</button>'
    );
  } else if (contact.stage === "meeting_proposed") {
    buttons.push('<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Comenté</button>');
  } else if (contact.stage === "nurture") {
    buttons.push(
      '<button class="interaction-btn" type="button" data-linkedin-action="comment_sent" data-contact-id="'+id+'">Nueva interacción</button>',
      '<button class="interaction-btn" type="button" data-crm-stage="conversation" data-contact-id="'+id+'">Retomó conversación</button>'
    );
  }

  return buttons.length
    ? '<div class="interaction-grid">'+buttons.join("")+'</div>'
    : '<div class="empty compact">No hay una acción rápida definida para esta etapa.</div>';
}

async function runCrmStageAction(contactId,stage) {
  try {
    await api("/contacts/"+contactId,{ method:"PATCH",body:{ stage } });
    await Promise.all([loadDashboard(),loadLinkedIn()]);
    if ($("#view-contacts")?.classList.contains("active-view")) await loadContacts();
    if ($("#view-pipeline")?.classList.contains("active-view")) await loadPipeline();
    if ($("#detail-dialog")?.open) await openContact(contactId);
  } catch(error) {
    alert(error.message || "No pudimos actualizar la etapa.");
    throw error;
  }
}

function bindCrmStageActions(root=document) {
  $$("[data-crm-stage]",root).forEach(btn=>btn.addEventListener("click",async()=>{
    const old=btn.textContent;
    btn.disabled=true;
    btn.textContent="Guardando…";
    try {
      await runCrmStageAction(btn.dataset.contactId,btn.dataset.crmStage);
    } finally {
      if (btn.isConnected) {
        btn.disabled=false;
        btn.textContent=old;
      }
    }
  }));
}

function linkedinTaskAction(task) {
  if (task.type === "linkedin_connect") return { action:"invite_sent",label:"Invitación enviada" };
  if (task.type === "linkedin_dm") return { action:"first_dm_sent",label:"DM enviado" };
  if (task.type === "linkedin_followup" && task.stage === "engaged") return { action:"accepted",label:"Aceptó" };
  if (task.type === "linkedin_followup" && task.stage === "connected") {
    return task.linkedin_followup_1_at
      ? { action:"followup_2_sent",label:"Follow-up #2 enviado" }
      : { action:"followup_1_sent",label:"Follow-up #1 enviado" };
  }
  return null;
}

async function runLinkedInAction(contactId,action) {
  const labels = {
    comment_sent:"Comentario registrado",
    invite_sent:"Invitación registrada",
    accepted:"Conexión registrada",
    first_dm_sent:"DM registrado",
    followup_1_sent:"Follow-up registrado",
    followup_2_sent:"Secuencia cerrada",
    reply_received:"Respuesta registrada",
    close_outreach:"Prospecto enviado a nurture"
  };
  try {
    await api("/linkedin/contacts/"+contactId+"/action",{
      method:"POST",
      body:{ action }
    });
    await loadLinkedIn();
    if ($("#view-contacts")?.classList.contains("active-view")) await loadContacts();
    if ($("#view-pipeline")?.classList.contains("active-view")) await loadPipeline();
    if ($("#detail-dialog")?.open) await openContact(contactId);
    return labels[action] || "Actualizado";
  } catch(error) {
    alert(error.message || "No pudimos registrar la acción.");
    throw error;
  }
}

function bindLinkedInActions(root=document) {
  $$("[data-linkedin-action]",root).forEach(btn=>btn.addEventListener("click",async()=>{
    const old=btn.textContent;
    btn.disabled=true;
    btn.textContent="Guardando…";
    try {
      await runLinkedInAction(btn.dataset.contactId,btn.dataset.linkedinAction);
    } finally {
      if (btn.isConnected) {
        btn.disabled=false;
        btn.textContent=old;
      }
    }
  }));
}

function renderLinkedIn() {
  const tasks=state.linkedin?.tasks||[];
  const upcoming=state.linkedin?.upcoming||[];
  const prospects=state.linkedin?.prospects||[];
  const stats=state.linkedin?.stats||{};
  const policy=state.linkedin?.policy||{};

  if ($("#linkedin-invites-today")) $("#linkedin-invites-today").textContent=Number(stats.invites_today||0)+"/"+Number(policy.dailyTarget||5);
  if ($("#linkedin-pending")) $("#linkedin-pending").textContent=Number(stats.pending||0);
  if ($("#linkedin-stale")) $("#linkedin-stale").textContent=Number(stats.stale_pending||0)+" con más de "+Number(policy.staleDays||14)+" días";
  if ($("#linkedin-acceptance")) $("#linkedin-acceptance").textContent=Number(stats.acceptance_rate||0).toFixed(1).replace(".0","")+"%";
  if ($("#linkedin-conversations")) $("#linkedin-conversations").textContent=Number(stats.conversations_or_beyond||0);

  $("#linkedin-tasks").innerHTML=tasks.length ? tasks.map(task=>{
    const primary=linkedinTaskAction(task);
    const canReply=task.stage==="connected" && ["linkedin_dm","linkedin_followup"].includes(task.type);
    return '<div class="stack-item">'+
      '<span class="stack-icon">in</span>'+
      '<div class="stack-main"><strong>'+esc(task.title)+'</strong><small>'+esc(task.contact_name)+(task.company?' · '+esc(task.company):'')+' · '+fmtDate(task.due_at)+'</small></div>'+
      '<div class="stack-actions">'+
        (task.linkedin_url?'<a class="stack-action" href="'+esc(task.linkedin_url)+'" target="_blank" rel="noopener">Abrir</a>':'')+
        (primary?'<button class="stack-action" data-linkedin-action="'+primary.action+'" data-contact-id="'+task.contact_id+'">'+esc(primary.label)+'</button>':'')+
        (canReply?'<button class="stack-action emphasis" data-linkedin-action="reply_received" data-contact-id="'+task.contact_id+'">Respondió</button>':'')+
        '<button class="stack-action" data-complete-task="'+task.id+'">Hecho</button>'+
      '</div>'+
    '</div>';
  }).join("") : empty("No tienes acciones de LinkedIn pendientes hoy.");

  $("#linkedin-upcoming").innerHTML=upcoming.length ? upcoming.map(task=>{
    const primary=linkedinTaskAction(task);
    return '<div class="stack-item">'+
      '<span class="stack-icon">in</span>'+
      '<div class="stack-main"><strong>'+esc(task.title)+'</strong><small>'+esc(task.contact_name)+(task.company?' · '+esc(task.company):'')+' · '+fmtDate(task.due_at)+'</small></div>'+
      '<div class="stack-actions">'+
        (task.linkedin_url?'<a class="stack-action" href="'+esc(task.linkedin_url)+'" target="_blank" rel="noopener">Abrir</a>':'')+
        (primary?'<button class="stack-action" data-linkedin-action="'+primary.action+'" data-contact-id="'+task.contact_id+'">'+esc(primary.label)+'</button>':'')+
      '</div>'+
    '</div>';
  }).join("") : empty("No hay acciones futuras programadas.");

  $("#linkedin-uncovered").innerHTML=prospects.length ? prospects.map(contact=>{
    const primary=linkedinNextAction(contact);
    const pending=contact.linkedin_pending_days!=null ? " · "+contact.linkedin_pending_days+"d pendiente" : "";
    return '<div class="stack-item">'+
      '<span class="stack-icon">'+initials(contact.name)+'</span>'+
      '<div class="stack-main"><strong>'+esc(contact.name)+(contact.target_score!=null?' · Score '+esc(contact.target_score):'')+'</strong><small>'+esc([contact.title,contact.company,contact.signal].filter(Boolean).join(" · "))+esc(pending)+'</small></div>'+
      '<div class="stack-actions">'+
        (contact.linkedin_url?'<a class="stack-action" href="'+esc(contact.linkedin_url)+'" target="_blank" rel="noopener">Abrir</a>':'')+
        (primary?'<button class="stack-action emphasis" data-linkedin-action="'+primary.action+'" data-contact-id="'+contact.id+'">'+esc(primary.label)+'</button>':'')+
        '<button class="stack-action" data-new-task-contact="'+contact.id+'">+ Acción</button>'+
      '</div>'+
    '</div>';
  }).join("") : empty("Todos los prospectos tienen seguimiento programado.");

  bindTaskActions($("#linkedin-tasks"));
  bindLinkedInActions($("#view-linkedin"));
  $$("[data-new-task-contact]").forEach(btn=>btn.addEventListener("click",()=>openTaskDialog(btn.dataset.newTaskContact)));
}

async function loadContent() {
  try {
    const data=await api("/content");
    state.content=data.content||[];
    renderContent();
  } catch(error){
    $("#content-grid").innerHTML=empty(error.message);
  }
}

function trackingUrl(item) {
  const params=new URLSearchParams({
    utm_source:"linkedin",
    utm_medium:"organic",
    utm_campaign:String(item.profile||"tres-pilares").toLowerCase().replace(/\s+/g,"-"),
    utm_content:item.tracking_code
  });
  return "https://trespilares.co/?"+params.toString()+"#agenda";
}

function renderContent() {
  $("#content-grid").innerHTML=state.content.length ? state.content.map(item=>
    '<article class="content-card">'+
      '<span class="eyebrow">'+esc(item.profile)+' · '+esc(item.status)+'</span>'+
      '<h3>'+esc(item.title)+'</h3>'+
      '<p>'+esc([item.pillar,item.topic].filter(Boolean).join(" · ") || "Sin clasificación")+'</p>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><span class="tracking-code">'+esc(item.tracking_code)+'</span><button class="text-action" data-copy="'+esc(trackingUrl(item))+'">Copiar link medible</button></div>'+
      '<div class="content-stats"><div><strong>'+Number(item.contacts||0)+'</strong><small>CONTACTOS</small></div><div><strong>'+Number(item.meetings_or_beyond||0)+'</strong><small>REUNIÓN+</small></div></div>'+
    '</article>'
  ).join("") : empty("Aún no hay contenido registrado.");

  $$("[data-copy]").forEach(btn=>btn.addEventListener("click",async()=>{
    await navigator.clipboard.writeText(btn.dataset.copy);
    const old=btn.textContent;
    btn.textContent="Copiado";
    setTimeout(()=>btn.textContent=old,1200);
  }));
}

async function createContent(event) {
  event.preventDefault();
  if(event.submitter?.value==="cancel") return;
  const form=new FormData(event.currentTarget);
  const publishedAt=form.get("publishedAt");
  try {
    await api("/content",{
      method:"POST",
      body:{
        profile:form.get("profile"),
        title:form.get("title"),
        url:form.get("url"),
        pillar:form.get("pillar"),
        topic:form.get("topic"),
        cta:form.get("cta"),
        status:form.get("status"),
        publishedAt:publishedAt ? new Date(publishedAt).toISOString() : null
      }
    });
    event.currentTarget.reset();
    $("#content-dialog").close();
    await loadContent();
  } catch(error){ setMessage("#content-message",error.message); }
}

function renderTeam() {
  const target=$("#team-list");
  if(!target) return;

  target.innerHTML=state.users.length ? state.users.map(user=>{
    const isSelf=user.id===state.user?.id;
    const canManage=state.user?.role==="admin" && !isSelf;
    const action=canManage
      ? '<button class="text-action '+(user.active?'danger-action':'')+'" data-toggle-user="'+user.id+'" data-next-active="'+(!user.active)+'">'+(user.active?'Quitar acceso':'Reactivar')+'</button>'
      : isSelf
        ? '<span class="muted" style="font-size:.7rem">Tu cuenta</span>'
        : '';

    return '<div class="stack-item">'+
      '<span class="stack-icon">'+initials(user.name)+'</span>'+
      '<div class="stack-main"><strong>'+esc(user.name)+'</strong><small>'+esc(user.email)+' · '+esc(user.role)+(user.lastLoginAt?' · Último acceso '+fmtDate(user.lastLoginAt):'')+'</small></div>'+
      '<span class="stage-badge">'+(user.active?'Activo':'Sin acceso')+'</span>'+
      action+
    '</div>';
  }).join("") : empty("No hay usuarios.");

  $$("[data-toggle-user]",target).forEach(btn=>btn.addEventListener("click",async()=>{
    const user=state.users.find(item=>item.id===btn.dataset.toggleUser);
    if(!user) return;

    const nextActive=btn.dataset.nextActive==="true";
    if(!nextActive) {
      const confirmed=confirm(
        "¿Quitar el acceso de "+user.name+"?\n\n"+
        "No se borra su historial, contactos ni actividad. El usuario no podrá volver a entrar con Google hasta que lo reactives."
      );
      if(!confirmed) return;
    }

    try {
      await api("/users/"+user.id,{ method:"PATCH",body:{ active:nextActive } });
      setMessage("#team-message",nextActive?"Acceso reactivado.":"Acceso retirado.",true);
      await loadUsers();
    } catch(error) {
      setMessage("#team-message",error.message);
    }
  }));
}

async function createUser(event) {
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  try {
    await api("/users",{
      method:"POST",
      body:{
        name:form.get("name"),
        email:form.get("email"),
        role:form.get("role")
      }
    });
    event.currentTarget.reset();
    setMessage("#team-message","Usuario creado.",true);
    await loadUsers();
  } catch(error){ setMessage("#team-message",error.message); }
}

function debounce(fn,wait=250){
  let timer;
  return (...args)=>{
    clearTimeout(timer);
    timer=setTimeout(()=>fn(...args),wait);
  };
}

init();
