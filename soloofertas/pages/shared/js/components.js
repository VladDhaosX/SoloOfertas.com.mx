(function () {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('beforeunload', () => window.scrollTo(0, 0));

  const region = document.body.dataset.region || 'gdl';

  function adjustRegionLinks(root) {
    root.querySelectorAll('[data-gdl-only]').forEach(el => {
      el.hidden = region !== 'gdl';
    });

    root.querySelectorAll('[data-region-href]').forEach(el => {
      const base = el.getAttribute('data-region-href');
      const adjusted = base.replace(/\/(gdl|mty)\//g, `/${region}/`);
      if (el.tagName === 'A') el.href = adjusted;
    });

    root.querySelectorAll('[data-region-link]').forEach(el => {
      el.classList.toggle('active', el.dataset.regionLink === region);
    });

    root.querySelectorAll('[data-region-empleos]').forEach(el => {
      if (el.tagName === 'A') el.href = `https://soloempleos.com.mx/`;
    });

    const logoImg = root.querySelector('[data-logo]');
    if (logoImg) logoImg.src = `/shared/img/logo-ofertas.png`;

    const path = window.location.pathname;
    const activePage = path.includes('/cupones') ? 'cupones' : path.includes('/contacto') ? 'contacto' : 'inicio';
    root.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === activePage);
    });
  }

  function initScrollTop() {
    const btn = document.getElementById('scroll-top-btn');
    if (!btn) return;
    window.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 300);
    });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    adjustRegionLinks(document);
    initScrollTop();
    requestAnimationFrame(() => document.body.classList.add('page-ready'));
  });
})();
