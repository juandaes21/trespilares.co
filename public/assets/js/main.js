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
const slotSelect = document.getElementById('lead-slot');

async function loadAvailability(date) {
  slotSelect.disabled = true;
  slotSelect.innerHTML = '<option value="">Consultando horarios…</option>';
  leadStatus.textContent = 'Consultando Google Calendar…';

  try {
    const response = await fetch(`${API_BASE_URL}/api/availability?date=${encodeURIComponent(date)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No pudimos consultar la agenda.');

    slotSelect.innerHTML = '';
    if (!data.slots?.length) {
      slotSelect.innerHTML = '<option value="">No hay horarios disponibles</option>';
      leadStatus.textContent = 'No hay espacios libres para esa fecha. Prueba otro día.';
      return;
    }

    slotSelect.append(new Option('Selecciona un horario', ''));
    data.slots.forEach(slot => slotSelect.append(new Option(slot.label, slot.start)));
    slotSelect.disabled = false;
    leadStatus.textContent = `${data.slots.length} horario(s) disponible(s).`;
    leadStatus.style.color = '';
  } catch (error) {
    slotSelect.innerHTML = '<option value="">Agenda no disponible</option>';
    leadStatus.textContent = error.message || 'No pudimos consultar la agenda.';
    leadStatus.style.color = '#9a3f35';
  }
}

if (leadForm) {
  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0,10);
  dateInput.min = localToday;

  dateInput.addEventListener('change', () => {
    if (dateInput.value) loadAvailability(dateInput.value);
  });

  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(leadForm);
    const payload = {
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      topic: String(form.get('topic') || '').trim(),
      startTime: String(form.get('startTime') || '').trim(),
      source: 'trespilares.co'
    };

    leadSubmit.disabled = true;
    leadSubmit.textContent = 'Confirmando…';
    leadStatus.textContent = 'Estamos reservando tu horario.';

    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible confirmar la cita.');

      leadForm.reset();
      slotSelect.disabled = true;
      slotSelect.innerHTML = '<option value="">Selecciona primero una fecha</option>';
      leadStatus.textContent = data.message || 'Tu cita quedó confirmada.';
      leadStatus.style.color = '#123E32';
    } catch (error) {
      leadStatus.textContent = error.message || 'No pudimos confirmar la cita.';
      leadStatus.style.color = '#9a3f35';
      if (dateInput.value) loadAvailability(dateInput.value);
    } finally {
      leadSubmit.disabled = false;
      leadSubmit.textContent = 'Quiero agendar →';
    }
  });
}
