(function () {
  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function whatsappHref(telefono) {
    let digits = String(telefono || '').replace(/\D/g, '');
    if (digits.length === 10) digits = `52${digits}`;
    return digits ? `https://wa.me/${digits}` : '';
  }

  function whatsappButton(telefono) {
    const href = whatsappHref(telefono);
    if (!href) return '';
    return `
      <a class="vacante-whatsapp" href="${escapeAttr(href)}" target="_blank" rel="noopener" aria-label="Contactanos por WhatsApp" data-tooltip="Contactanos">
        <img src="/shared/img/whatsapp.svg" alt="" aria-hidden="true">
      </a>
    `;
  }

  async function cargarVacantes() {
    const region = document.body.dataset.region || 'gdl';
    const type = document.body.dataset.content || 'vacantes';
    const grid = document.getElementById('vacantes-grid');
    if (!grid) return;
    const regionName = region === 'mty' ? 'Monterrey' : 'Guadalajara';

    if (grid.dataset.ssr === type && grid.querySelector('.vacante-item')) {
      requestAnimationFrame(() => grid.classList.add('is-ready'));
      return;
    }

    try {
      const res = await fetch(`/${region}/data/${type}.json`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        grid.innerHTML = `<p class="vacantes-empty">No hay ${type === 'cupones' ? 'cupones' : 'vacantes'} disponibles</p>`;
        return;
      }

      const MIN_CELLS = type === 'cupones' ? 0 : 8;
      const items = data.map(v => `
        <div class="vacante-item">
          <img
            src="${escapeAttr(v.url)}"
            data-full-src="${escapeAttr(v.url)}"
            alt="${escapeAttr(type === 'cupones' ? `Cupón en ${regionName}` : `Vacante en ${regionName}`)}"
            loading="lazy"
            decoding="async"
            onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'"
          >
          ${type === 'vacantes' ? whatsappButton(v.telefono) : ''}
        </div>
      `).join('');
      const empty = data.length < MIN_CELLS
        ? Array(MIN_CELLS - data.length).fill('<div class="vacante-item vacante-empty"></div>').join('')
        : '';
      grid.innerHTML = items + empty;
      requestAnimationFrame(() => grid.classList.add('is-ready'));
    } catch (_) {
      grid.innerHTML = `<p class="vacantes-empty">No hay ${type === 'cupones' ? 'cupones' : 'vacantes'} disponibles</p>`;
    }
  }

  function initModal() {
    const grid = document.getElementById('vacantes-grid');
    if (!grid) return;
    const gallery = document.querySelector('.vacantes-section') || grid;
    const isCoupons = document.body.dataset.content === 'cupones';

    const modal = document.createElement('div');
    modal.className = `vacante-modal${isCoupons ? ' is-cupones' : ''}`;
    modal.innerHTML = `
      <button class="vacante-modal-close" aria-label="Cerrar">&times;</button>
      <img class="vacante-modal-img" alt="">
      <a class="vacante-modal-download" href="#" download aria-label="Descargar cupón" data-tooltip="Descargar cupón">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.2l3.6-3.6L18 11l-6 6-6-6 1.4-1.4 3.6 3.6V3zM5 19h14v2H5z"/></svg>
      </a>
      <a class="vacante-modal-whatsapp" href="#" target="_blank" rel="noopener" aria-label="Contactanos por WhatsApp" data-tooltip="Contactanos">
        <img src="/shared/img/whatsapp.svg" alt="" aria-hidden="true">
      </a>
    `;
    document.body.appendChild(modal);

    const modalImg = modal.querySelector('.vacante-modal-img');
    const modalDownload = modal.querySelector('.vacante-modal-download');
    const modalWhatsapp = modal.querySelector('.vacante-modal-whatsapp');

    function open(src, whatsappUrl) {
      modalImg.src = src;
      if (isCoupons) modalDownload.href = new URL(src, window.location.href).pathname;
      if (whatsappUrl) {
        modalWhatsapp.href = whatsappUrl;
        modalWhatsapp.style.display = 'inline-flex';
      } else {
        modalWhatsapp.removeAttribute('href');
        modalWhatsapp.style.display = 'none';
      }
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      modal.classList.remove('is-open');
      modalImg.src = '';
      document.body.style.overflow = '';
    }

    gallery.addEventListener('click', (e) => {
      if (e.target.closest('.vacante-whatsapp')) return;
      const img = e.target.closest('.vacante-item img, .cupon-destacado img');
      if (!img) return;
      const item = img.closest('.vacante-item');
      const whatsapp = item ? item.querySelector('.vacante-whatsapp') : null;
      open(img.dataset.fullSrc || img.currentSrc || img.src, whatsapp ? whatsapp.href : '');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('vacante-modal-close')) close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cargarVacantes();
    initModal();
  });
})();
