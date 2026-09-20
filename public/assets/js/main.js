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

if (leadForm) {
  const dateInput = document.getElementById('lead-date');
  if (dateInput) {
    const today = new Date();
    const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
    dateInput.min = localToday;
  }

  leadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(leadForm);
    const payload = {
      name: String(form.get('name') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      topic: String(form.get('topic') || '').trim(),
      preferredDate: String(form.get('preferredDate') || '').trim() || null,
      preferredTime: String(form.get('preferredTime') || '').trim() || null,
      source: 'trespilares.co'
    };

    leadSubmit.disabled = true;
    leadSubmit.textContent = 'Enviando…';
    leadStatus.textContent = 'Estamos registrando tu solicitud.';

    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'No fue posible registrar la solicitud.');
      }

      leadForm.reset();
      leadStatus.textContent = data.message || 'Recibimos tu solicitud. Te contactaremos para confirmar la cita.';
      leadStatus.style.color = '#123E32';
    } catch (error) {
      leadStatus.textContent = error.message || 'No pudimos registrar tu solicitud. Intenta nuevamente.';
      leadStatus.style.color = '#9a3f35';
    } finally {
      leadSubmit.disabled = false;
      leadSubmit.textContent = 'Quiero agendar →';
    }
  });
}
