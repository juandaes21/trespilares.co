(() => {
  'use strict';
  const API_BASE = 'https://tres-pilares-api-production.up.railway.app';
  const form = document.getElementById('webinar-form');
  const submit = document.getElementById('submit-btn');
  const feedback = document.getElementById('form-feedback');
  const success = document.getElementById('form-success');
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
  if (!form || !submit || !feedback || !success) return;

  function attribution() {
    const params = new URLSearchParams(window.location.search);
    const origin = params.get('utm_source') || '';
    return {
      source: origin.slice(0, 80),
      medium: (params.get('utm_medium') || '').slice(0, 80),
      campaign: (params.get('utm_campaign') || '').slice(0, 120),
      content: (params.get('utm_content') || '').slice(0, 120),
      referrer: document.referrer.slice(0, 500),
      landingUrl: window.location.href.split('#')[0].slice(0, 800)
    };
  }
  function setMessage(message) {
    feedback.textContent = message;
  }
  form.querySelectorAll('input,select').forEach((field) => {
    field.addEventListener('input', () => {
      field.removeAttribute('aria-invalid');
      setMessage('');
    });
    field.addEventListener('change', () => {
      field.removeAttribute('aria-invalid');
      setMessage('');
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      if (invalid) {
        invalid.setAttribute('aria-invalid', 'true');
        invalid.focus();
      }
      setMessage('Revisa los campos obligatorios y autoriza el uso de tus datos para la inscripción.');
      return;
    }
    const data = new FormData(form);
    const payload = {
      eventSlug: 'vida-socios',
      name: String(data.get('name') || '').trim(),
      email: String(data.get('email') || '').trim().toLowerCase(),
      company: String(data.get('company') || '').trim(),
      role: String(data.get('role') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      consent: document.getElementById('consent').checked,
      website: String(data.get('website') || ''),
      attribution: attribution()
    };

    submit.disabled = true;
    submit.innerHTML = 'Registrando tu interés…';
    setMessage('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(API_BASE + '/api/webinars/vida-socios/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'No fue posible completar tu inscripción.');
      form.hidden = true;
      success.hidden = false;
      success.focus?.();
      success.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'La conexión tardó demasiado. Verifica tu internet e inténtalo nuevamente.'
        : (err instanceof TypeError
          ? 'No pudimos conectar con el registro. Inténtalo más tarde o escríbenos a trespilares.co@gmail.com.'
          : err.message);
      setMessage(message);
    } finally {
      clearTimeout(timeout);
      submit.disabled = false;
      submit.innerHTML = 'Quiero reservar mi lugar <span aria-hidden="true">↗</span>';
    }
  });
})();