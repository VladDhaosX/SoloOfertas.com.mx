(function () {
  async function cargarVacantes() {
    const region = document.body.dataset.region || 'gdl';
    const grid = document.getElementById('vacantes-grid');
    if (!grid) return;

    if (grid.dataset.ssr === 'vacantes' && grid.querySelector('.vacante-item')) {
      requestAnimationFrame(() => grid.classList.add('is-ready'));
      return;
    }

    try {
      const res = await fetch(`/${region}/data/vacantes.json`);
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        grid.innerHTML = '<p class="vacantes-empty">No hay vacantes disponibles</p>';
        return;
      }

      const MIN_CELLS = 8;
      const items = data.map(v => `
        <div class="vacante-item">
          <img
            src="${v.url}"
            alt="Vacante"
            loading="lazy"
            onerror="this.onerror=null;this.src='/shared/img/placeholder.svg'"
          >
        </div>
      `).join('');
      const empty = data.length < MIN_CELLS
        ? Array(MIN_CELLS - data.length).fill('<div class="vacante-item vacante-empty"></div>').join('')
        : '';
      grid.innerHTML = items + empty;
      requestAnimationFrame(() => grid.classList.add('is-ready'));
    } catch (_) {
      grid.innerHTML = '<p class="vacantes-empty">No hay vacantes disponibles</p>';
    }
  }

  function initModal() {
    const grid = document.getElementById('vacantes-grid');
    if (!grid) return;

    const modal = document.createElement('div');
    modal.className = 'vacante-modal';
    modal.innerHTML = `
      <button class="vacante-modal-close" aria-label="Cerrar">&times;</button>
      <img class="vacante-modal-img" alt="">
    `;
    document.body.appendChild(modal);

    const modalImg = modal.querySelector('.vacante-modal-img');

    function open(src) {
      modalImg.src = src;
      modal.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      modal.classList.remove('is-open');
      modalImg.src = '';
      document.body.style.overflow = '';
    }

    grid.addEventListener('click', (e) => {
      const img = e.target.closest('.vacante-item img');
      if (!img) return;
      open(img.currentSrc || img.src);
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
