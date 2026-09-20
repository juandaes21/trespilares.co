const nav = document.getElementById('nav');
window.addEventListener('scroll',()=>nav.classList.toggle('scrolled',window.scrollY>25));

const observer = new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}
  });
},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));

const mobileMenu = document.getElementById('mobile-menu');
const navLinks = document.querySelectorAll('.navlinks a');
if (mobileMenu) {
  mobileMenu.addEventListener('click', () => {
    const open = nav.classList.toggle('menu-open');
    mobileMenu.setAttribute('aria-expanded', String(open));
    mobileMenu.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  });
  navLinks.forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('menu-open');
    mobileMenu.setAttribute('aria-expanded', 'false');
  }));
}

const API_BASE_URL = 'https://tres-pilares-api-production.up.railway.app';
const leadForm = document.getElementById('lead-form');
const leadStatus = document.getElementById('sent');
const leadSubmit = document.getElementById('lead-submit');
const dateInput = document.getElementById('lead-date');
const slotInput = document.getElementById('lead-slot');
const calendarGrid = document.getElementById('calendar-grid');
const calendarMonth = document.getElementById('calendar-month');
const calendarPrev = document.getElementById('calendar-prev');
const calendarNext = document.getElementById('calendar-next');
const selectedDateLabel = document.getElementById('selected-date-label');
const slotCount = document.getElementById('slot-count');
const timeSlots = document.getElementById('time-slots');
const bookingSelection = document.getElementById('booking-selection');
const bookingSelectionText = document.getElementById('booking-selection-text');

const BOGOTA_TZ = 'America/Bogota';
const MAX_BOOKING_DAYS = 30;
let visibleMonth;
let selectedDate = '';
let selectedSlot = '';
let monthAvailability = {};

function dateKeyUTC(year, monthIndex, day) {
  return [year, String(monthIndex + 1).padStart(2,'0'), String(day).padStart(2,'0')].join('-');
}

function bogotaTodayParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TZ, year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return { year:Number(map.year), month:Number(map.month)-1, day:Number(map.day) };
}

function keyToUtcDate(key) {
  const [y,m,d] = key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d));
}

function formatDateLong(key) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone:'UTC', weekday:'long', day:'numeric', month:'long'
  }).format(keyToUtcDate(key));
}

function setCalendarStatus(message, error=false) {
  leadStatus.textContent = message;
  leadStatus.style.color = error ? '#9a3f35' : '';
}

async function loadMonthAvailability() {
  const y = visibleMonth.getUTCFullYear();
  const m = visibleMonth.getUTCMonth();
  const firstKey = dateKeyUTC(y,m,1);
  const daysInMonth = new Date(Date.UTC(y,m+1,0)).getUTCDate();

  calendarGrid.querySelectorAll('.calendar-day').forEach(btn => {
    if (!btn.disabled) btn.classList.add('loading');
  });

  try {
    const response = await fetch(`${API_BASE_URL}/api/availability/range?start=${firstKey}&days=${daysInMonth}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No pudimos consultar la agenda.');
    monthAvailability = data.dates || {};
    renderCalendar();
    setCalendarStatus('Selecciona el día y la hora que mejor te funcionen.');
  } catch (error) {
    monthAvailability = {};
    renderCalendar();
    setCalendarStatus(error.message || 'No pudimos consultar la agenda.', true);
  }
}

function renderCalendar() {
  if (!calendarGrid) return;
  const y = visibleMonth.getUTCFullYear();
  const m = visibleMonth.getUTCMonth();
  calendarMonth.textContent = new Intl.DateTimeFormat('es-CO', {
    month:'long', year:'numeric', timeZone:'UTC'
  }).format(visibleMonth);

  calendarGrid.innerHTML = '';
  const firstWeekday = (new Date(Date.UTC(y,m,1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y,m+1,0)).getUTCDate();
  for(let i=0;i<firstWeekday;i++){
    const spacer=document.createElement('span');
    spacer.className='calendar-day outside';
    calendarGrid.append(spacer);
  }

  const today = bogotaTodayParts();
  const todayKey = dateKeyUTC(today.year,today.month,today.day);
  const maxDate = new Date(Date.UTC(today.year,today.month,today.day + MAX_BOOKING_DAYS));

  for(let day=1;day<=daysInMonth;day++){
    const key=dateKeyUTC(y,m,day);
    const current=keyToUtcDate(key);
    const availability=monthAvailability[key];
    const button=document.createElement('button');
    button.type='button';
    button.className='calendar-day';
    button.textContent=String(day);
    button.setAttribute('role','gridcell');
    button.setAttribute('aria-label', formatDateLong(key));

    const outsideWindow = current < keyToUtcDate(todayKey) || current > maxDate;
    const available = Boolean(availability?.available);
    button.disabled = outsideWindow || !available;
    if(available && !outsideWindow) button.classList.add('available');
    if(key===todayKey) button.classList.add('today');
    if(key===selectedDate) button.classList.add('selected');

    if(!button.disabled){
      button.addEventListener('click',()=>selectDate(key));
    }
    calendarGrid.append(button);
  }

  const prevMonth = new Date(Date.UTC(y,m-1,1));
  const currentMonth = new Date(Date.UTC(today.year,today.month,1));
  calendarPrev.disabled = prevMonth < currentMonth;
  const nextMonth = new Date(Date.UTC(y,m+1,1));
  calendarNext.disabled = nextMonth > new Date(Date.UTC(maxDate.getUTCFullYear(),maxDate.getUTCMonth(),1));
}

async function selectDate(key) {
  selectedDate=key;
  selectedSlot='';
  dateInput.value=key;
  slotInput.value='';
  bookingSelection.hidden=true;
  renderCalendar();

  selectedDateLabel.textContent = formatDateLong(key);
  slotCount.textContent = 'Consultando disponibilidad…';
  timeSlots.innerHTML = '<div class="scheduler-loading">Buscando horarios disponibles…</div>';

  try{
    const response=await fetch(`${API_BASE_URL}/api/availability?date=${encodeURIComponent(key)}`);
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || 'No pudimos consultar los horarios.');

    timeSlots.innerHTML='';
    if(!data.slots?.length){
      slotCount.textContent='Sin horarios disponibles';
      timeSlots.innerHTML='<div class="scheduler-empty">Este día ya no tiene espacios. Elige otra fecha.</div>';
      monthAvailability[key]={available:false,slots:0};
      renderCalendar();
      return;
    }

    slotCount.textContent=`${data.slots.length} horario${data.slots.length===1?'':'s'} disponible${data.slots.length===1?'':'s'}`;
    data.slots.forEach(slot=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='time-slot';
      btn.innerHTML=`<span>${slot.label}</span><small>30 min · Meet</small>`;
      btn.addEventListener('click',()=>selectSlot(slot,btn));
      timeSlots.append(btn);
    });
  }catch(error){
    slotCount.textContent='No disponible';
    timeSlots.innerHTML=`<div class="scheduler-empty">${error.message || 'No pudimos consultar la agenda.'}</div>`;
  }
}

function selectSlot(slot,button){
  selectedSlot=slot.start;
  slotInput.value=slot.start;
  timeSlots.querySelectorAll('.time-slot').forEach(btn=>btn.classList.remove('selected'));
  button.classList.add('selected');
  bookingSelectionText.textContent=`${formatDateLong(selectedDate)} · ${slot.label}`;
  bookingSelection.hidden=false;
  setCalendarStatus('Horario seleccionado. Completa tus datos y confirma la cita.');
}

function shiftMonth(delta){
  visibleMonth=new Date(Date.UTC(
    visibleMonth.getUTCFullYear(),
    visibleMonth.getUTCMonth()+delta,
    1
  ));
  monthAvailability={};
  renderCalendar();
  loadMonthAvailability();
}

async function initScheduler(){
  if(!calendarGrid) return;
  const today=bogotaTodayParts();
  visibleMonth=new Date(Date.UTC(today.year,today.month,1));
  renderCalendar();
  timeSlots.innerHTML='<div class="scheduler-empty">Selecciona un día disponible en el calendario.</div>';
  await loadMonthAvailability();
}

calendarPrev?.addEventListener('click',()=>shiftMonth(-1));
calendarNext?.addEventListener('click',()=>shiftMonth(1));

if (leadForm) {
  initScheduler();

  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if(!selectedDate || !selectedSlot){
      setCalendarStatus('Selecciona primero una fecha y un horario disponible.', true);
      document.getElementById('scheduler')?.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }

    const form = new FormData(leadForm);
    const payload = {
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      topic: String(form.get('topic') || '').trim(),
      startTime: selectedSlot,
      source: 'trespilares.co'
    };

    leadSubmit.disabled = true;
    leadSubmit.textContent = 'Confirmando…';
    setCalendarStatus('Estamos reservando tu horario en Google Calendar.');

    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible confirmar la cita.');

      const confirmation = bookingSelectionText.textContent;
      leadForm.reset();
      selectedDate='';
      selectedSlot='';
      dateInput.value='';
      slotInput.value='';
      bookingSelection.hidden=true;
      timeSlots.innerHTML='<div class="scheduler-empty">Selecciona un día disponible en el calendario.</div>';
      selectedDateLabel.textContent='Elige una fecha';
      slotCount.textContent='Los horarios aparecerán aquí';
      await loadMonthAvailability();
      leadStatus.textContent = `Cita confirmada${confirmation ? ' · ' + confirmation : ''}. Revisa tu correo para la invitación de Google Calendar.`;
      leadStatus.style.color = '#123E32';
    } catch (error) {
      setCalendarStatus(error.message || 'No pudimos confirmar la cita.', true);
      if (selectedDate) await selectDate(selectedDate);
    } finally {
      leadSubmit.disabled = false;
      leadSubmit.textContent = 'Quiero agendar →';
    }
  });
}
