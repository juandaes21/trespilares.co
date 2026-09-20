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

const leadForm = document.getElementById('lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', (event) => {
    event.preventDefault();
    document.getElementById('sent').textContent = 'Formulario listo para conectarlo a tu CRM o agenda.';
  });
}