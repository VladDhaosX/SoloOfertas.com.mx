(function () {
  const state = {
    token: localStorage.getItem('se_token'),
    region: 'gdl',
    section: 'portada',
    cupones: [],
  };
  const FEATURES = Object.freeze({ coupons: false });

  // ──────────────────────────
  // Auth
  // ──────────────────────────
  const Auth = {
    isAuthenticated() {
      if (!state.token) return false;
      try {
        const payload = JSON.parse(atob(state.token.split('.')[1]));
        return payload.exp * 1000 > Date.now();
      } catch (_) {
        return false;
      }
    },
    async login(usuario, password) {
      const res = await fetch('/soloofertas/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Error de autenticación');
      }
      const { token } = await res.json();
      state.token = token;
      localStorage.setItem('se_token', token);
    },
    logout() {
      state.token = null;
      localStorage.removeItem('se_token');
    },
  };

  // ──────────────────────────
  // API helper
  // ──────────────────────────
  async function apiRequest(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      Auth.logout();
      UI.showLogin();
      return null;
    }
    return res;
  }

  // ──────────────────────────
  // UI helpers
  // ──────────────────────────
  const UI = {
    showLogin() {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('admin-panel').style.display = 'none';
    },
    showPanel() {
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('admin-panel').style.display = 'flex';
    },
    setStatus(id, type, msg) {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = `upload-status ${type}`;
      el.textContent = msg;
    },
    clearStatus(id) {
      const el = document.getElementById(id);
      if (el) { el.className = 'upload-status'; el.textContent = ''; }
    },
    confirm(msg) {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'admin-modal-overlay';
        overlay.innerHTML = `
          <div class="admin-modal">
            <p class="admin-modal-msg">${msg}</p>
            <div class="admin-modal-actions">
              <button class="btn-modal btn-modal-cancel">Cancelar</button>
              <button class="btn-modal btn-modal-confirm">Confirmar</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const done = (v) => { overlay.remove(); resolve(v); };
        overlay.querySelector('.btn-modal-cancel').addEventListener('click', () => done(false));
        overlay.querySelector('.btn-modal-confirm').addEventListener('click', () => done(true));
        overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
      });
    },
    phoneModal(currentPhone = '') {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'admin-modal-overlay';
        overlay.innerHTML = `
          <div class="admin-modal admin-modal-small">
            <form class="admin-phone-form">
              <label class="admin-phone-label" for="vacante-phone-input">Numero de telefono</label>
              <input
                id="vacante-phone-input"
                class="admin-phone-input"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="Ej. 8123456789"
                value="${escapeAttr(currentPhone)}"
              >
              <div class="admin-modal-actions">
                <button type="button" class="btn-modal btn-modal-cancel">Cancelar</button>
                <button type="submit" class="btn-modal btn-modal-confirm">Guardar</button>
              </div>
            </form>
          </div>`;
        document.body.appendChild(overlay);

        const input = overlay.querySelector('.admin-phone-input');
        const form = overlay.querySelector('.admin-phone-form');
        const done = (v) => { overlay.remove(); resolve(v); };

        input.focus();
        input.select();
        overlay.querySelector('.btn-modal-cancel').addEventListener('click', () => done(null));
        overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });
        form.addEventListener('submit', e => {
          e.preventDefault();
          done(input.value.trim());
        });
      });
    },
  };

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function mediaUrl(region, type, url, preset = 'admin') {
    const filename = String(url || '').split('/').pop();
    if (!filename) return '';
    return `/media/${region}/${type}/${encodeURIComponent(filename)}?preset=${encodeURIComponent(preset)}`;
  }

  function getFilenameFromDisposition(disposition) {
    const match = /filename="?([^";]+)"?/i.exec(disposition || '');
    return match ? match[1] : '';
  }

  function setBackupStatus(type, message) {
    const el = document.getElementById('backup-status');
    if (!el) return;
    el.className = `backup-status ${type || ''}`;
    el.textContent = message || '';
  }

  async function downloadBackup() {
    const btn = document.getElementById('btn-backup');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Preparando...';
    setBackupStatus('', 'Generando respaldo de datos e imagenes...');
    try {
      const res = await apiRequest('/soloofertas/backup');
      if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo generar el respaldo');
      }
      const blob = await res.blob();
      const filename = getFilenameFromDisposition(res.headers.get('Content-Disposition')) ||
        `soloofertas-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupStatus('ok', 'Respaldo descargado.');
    } catch (err) {
      setBackupStatus('error', err.message || 'Error al descargar el respaldo');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Descargar respaldo';
    }
  }

  async function restoreBackup(file) {
    if (!file) return;
    const confirmed = await UI.confirm(
      'La restauracion reemplazara portada y ofertas de ambas ciudades. El contenido actual se conservara como snapshot. ¿Continuar?'
    );
    if (!confirmed) return;

    const input = document.getElementById('input-backup');
    const button = document.querySelector('.btn-restore');
    if (button) button.classList.add('is-disabled');
    setBackupStatus('', 'Validando y restaurando respaldo...');
    try {
      const form = new FormData();
      form.append('backup', file);
      const res = await apiRequest('/soloofertas/backup/restore', { method: 'POST', body: form });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo restaurar el respaldo');
      setBackupStatus('ok', `Restaurado: ${data.files} archivo(s). Snapshot: ${data.snapshot}.`);
      await loadPortada();
      await loadVacantes();
    } catch (err) {
      setBackupStatus('error', err.message || 'Error al restaurar el respaldo');
    } finally {
      if (button) button.classList.remove('is-disabled');
      if (input) input.value = '';
    }
  }

  // ──────────────────────────
  // Portada
  // ──────────────────────────
  async function loadPortada() {
    try {
      const res = await fetch(`/${state.region}/data/portada.json`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const img = document.getElementById('portada-preview');
      const ph = document.getElementById('portada-placeholder');
      img.src = mediaUrl(state.region, 'portadas', data.url, 'cover');
      img.style.display = 'block';
      img.onerror = () => {
        img.style.display = 'none';
        ph.style.display = 'flex';
      };
      ph.style.display = 'none';
    } catch (_) {
      document.getElementById('portada-preview').style.display = 'none';
      document.getElementById('portada-placeholder').style.display = 'flex';
    }
  }

  async function uploadPortada(file) {
    UI.setStatus('portada-status', 'loading', 'Subiendo...');
    const fd = new FormData();
    fd.append('imagen', file);

    const res = await apiRequest(`/soloofertas/${state.region}/portada`, { method: 'POST', body: fd });
    if (!res) return;

    if (res.ok) {
      UI.setStatus('portada-status', 'ok', 'Portada actualizada.');
      await loadPortada();
    } else {
      const d = await res.json().catch(() => ({}));
      UI.setStatus('portada-status', 'error', d.error || 'Error al subir');
    }
  }

  // ──────────────────────────
  // Vacantes
  // ──────────────────────────
  async function loadVacantes() {
    const grid = document.getElementById('vacantes-grid');
    grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Cargando...</p>';
    try {
      const res = await fetch(`/${state.region}/data/vacantes.json`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      renderVacantesGrid(data);
    } catch (_) {
      grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Sin ofertas</p>';
    }
  }

  function renderVacantesGrid(data) {
    const grid = document.getElementById('vacantes-grid');
    if (!data.length) {
      grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Sin ofertas</p>';
      return;
    }
    grid.innerHTML = data.map(v => {
      const rot = Number(v.rotation) || 0;
      const rotStyle = rot ? ` style="transform:rotate(${rot}deg)"` : '';
      const telefono = v.telefono || '';
      return `
      <div class="admin-vacante-item" data-id="${v.id}" data-rotation="${rot}" data-telefono="${escapeAttr(telefono)}" draggable="true">
        <img src="${mediaUrl(state.region, 'vacantes', v.url)}" alt="Oferta" loading="lazy"${rotStyle}
             onerror="this.onerror=null;this.style.opacity='.3'">
        <div class="vacante-menu">
          <button class="btn-menu-vacante" data-id="${v.id}" type="button" title="Opciones" aria-label="Opciones">...</button>
          <div class="vacante-menu-panel" role="menu">
            <button class="btn-phone-vacante" data-id="${v.id}" type="button" role="menuitem">${telefono ? 'Editar numero' : 'Agregar numero'}</button>
            <button class="btn-rotate-vacante" data-id="${v.id}" type="button" role="menuitem">Rotar 90&deg;</button>
          </div>
        </div>
        ${telefono ? '<span class="vacante-phone-badge" title="Tiene telefono">TEL</span>' : ''}
        <button class="btn-delete-vacante" data-id="${v.id}" title="Eliminar">&#10005;</button>
      </div>
    `;
    }).join('');

    grid.querySelectorAll('.btn-menu-vacante').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = btn.closest('.vacante-menu');
        grid.querySelectorAll('.vacante-menu.is-open').forEach(openMenu => {
          if (openMenu !== menu) openMenu.classList.remove('is-open');
        });
        menu.classList.toggle('is-open');
      });
    });

    grid.querySelectorAll('.btn-phone-vacante').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.closest('.vacante-menu').classList.remove('is-open');
        editVacantePhone(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.btn-delete-vacante').forEach(btn => {
      btn.addEventListener('click', () => deleteVacante(btn.dataset.id));
    });

    grid.querySelectorAll('.btn-rotate-vacante').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.closest('.vacante-menu')?.classList.remove('is-open');
        rotateVacante(btn.dataset.id);
      });
    });

    initDragAndDrop(grid);
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('.vacante-menu')) return;
    document.querySelectorAll('.vacante-menu.is-open').forEach(menu => menu.classList.remove('is-open'));
  });

  async function saveOrder(grid, collection = 'vacantes') {
    const ids = [...grid.querySelectorAll('.admin-vacante-item')].map(el => el.dataset.id);
    const statusId = collection === 'cupones' ? 'cupones-status' : 'vacantes-status';
    UI.setStatus(statusId, 'loading', 'Guardando orden...');
    const res = await apiRequest(`/soloofertas/${state.region}/${collection}/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res) return;
    if (res.ok) UI.setStatus(statusId, 'ok', 'Orden guardado.');
    else UI.setStatus(statusId, 'error', 'Error al guardar orden');
  }

  function reorderItems(grid, src, target, collection) {
    const items = [...grid.querySelectorAll('.admin-vacante-item')];
    const srcIdx = items.indexOf(src);
    const dstIdx = items.indexOf(target);
    if (srcIdx < dstIdx) target.after(src);
    else target.before(src);
    target.classList.remove('drag-over');
    saveOrder(grid, collection);
  }

  function initDragAndDrop(grid, collection = 'vacantes') {

    // ── Desktop ──────────────────────────────────────
    let dragSrc = null;

    grid.querySelectorAll('.admin-vacante-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        dragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item !== dragSrc) {
          grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
          item.classList.add('drag-over');
        }
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragSrc || dragSrc === item) return;
        reorderItems(grid, dragSrc, item, collection);
      });
    });

    // ── Mobile (Touch) ───────────────────────────────
    let touchSrc = null;
    let touchClone = null;
    let touchOffsetX = 0;
    let touchOffsetY = 0;

    function getItemAtPoint(x, y) {
      if (touchClone) touchClone.style.display = 'none';
      const el = document.elementFromPoint(x, y);
      if (touchClone) touchClone.style.display = '';
      return el && el.closest('.admin-vacante-item');
    }

    grid.querySelectorAll('.admin-vacante-item').forEach(item => {
      item.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        const rect = item.getBoundingClientRect();
        touchSrc = item;
        touchOffsetX = touch.clientX - rect.left;
        touchOffsetY = touch.clientY - rect.top;

        touchClone = item.cloneNode(true);
        Object.assign(touchClone.style, {
          position: 'fixed',
          width: rect.width + 'px',
          height: rect.height + 'px',
          left: (touch.clientX - touchOffsetX) + 'px',
          top: (touch.clientY - touchOffsetY) + 'px',
          opacity: '0.75',
          pointerEvents: 'none',
          zIndex: '9999',
          borderRadius: '3px',
          transition: 'none',
        });
        document.body.appendChild(touchClone);
        item.classList.add('dragging');
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!touchSrc || !touchClone) return;
        e.preventDefault();
        const touch = e.touches[0];
        touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
        touchClone.style.top  = (touch.clientY - touchOffsetY) + 'px';

        const target = getItemAtPoint(touch.clientX, touch.clientY);
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
        if (target && target !== touchSrc) target.classList.add('drag-over');
      }, { passive: false });

      item.addEventListener('touchend', (e) => {
        if (!touchSrc || !touchClone) return;
        const touch = e.changedTouches[0];
        touchClone.remove();
        touchClone = null;
        touchSrc.classList.remove('dragging');
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));

        const target = getItemAtPoint(touch.clientX, touch.clientY);
        if (target && target !== touchSrc) reorderItems(grid, touchSrc, target, collection);
        touchSrc = null;
      });
    });
  }

  async function uploadVacantes(files) {
    const total = files.length;
    for (let i = 0; i < total; i++) {
      UI.setStatus('vacantes-status', 'loading', `Subiendo ${i + 1} de ${total}...`);
      const fd = new FormData();
      fd.append('imagen', files[i]);
      const res = await apiRequest(`/soloofertas/${state.region}/vacantes`, { method: 'POST', body: fd });
      if (!res) return;
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        UI.setStatus('vacantes-status', 'error', d.error || 'Error al subir');
        return;
      }
    }
    UI.setStatus('vacantes-status', 'ok', `${total} oferta(s) subida(s).`);
    await loadVacantes();
  }

  async function replaceCarpetaVacantes(files) {
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!images.length) {
      UI.setStatus('vacantes-status', 'error', 'No se encontraron imágenes en la carpeta');
      return;
    }

    images.sort((a, b) => {
      const numA = parseInt(a.name, 10);
      const numB = parseInt(b.name, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.name.localeCompare(b.name);
    });

    if (!await UI.confirm(`¿Reemplazar todas las ofertas con ${images.length} imágenes?\nEsta acción elimina las ofertas actuales.`)) return;

    UI.setStatus('vacantes-status', 'loading', `Subiendo ${images.length} imagen(es)...`);
    const fd = new FormData();
    images.forEach(f => fd.append('imagenes', f));

    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/replace-all`, { method: 'POST', body: fd });
    if (!res) return;

    if (res.ok) {
      const d = await res.json();
      UI.setStatus('vacantes-status', 'ok', `${d.total} oferta(s) reemplazadas.`);
      await loadVacantes();
    } else {
      const d = await res.json().catch(() => ({}));
      UI.setStatus('vacantes-status', 'error', d.error || 'Error al reemplazar');
    }
  }

  async function deleteVacante(id) {
    if (!await UI.confirm('¿Eliminar esta oferta?')) return;
    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.ok) {
      const item = document.querySelector(`.admin-vacante-item[data-id="${id}"]`);
      if (item) item.remove();
    } else {
      alert('Error al eliminar oferta');
    }
  }

  async function rotateVacante(id) {
    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/${id}/rotate`, { method: 'PUT' });
    if (!res) return;
    if (!res.ok) {
      UI.setStatus('vacantes-status', 'error', 'Error al rotar la oferta');
      return;
    }
    const { rotation } = await res.json();
    const item = [...document.querySelectorAll('#vacantes-grid .admin-vacante-item')]
      .find(element => element.dataset.id === id);
    if (item) {
      item.dataset.rotation = String(rotation);
      item.querySelector('img').style.transform = `rotate(${rotation}deg)`;
    }
  }

  async function editVacantePhone(id) {
    const item = document.querySelector(`.admin-vacante-item[data-id="${id}"]`);
    const currentPhone = item ? item.dataset.telefono : '';
    const telefono = await UI.phoneModal(currentPhone);
    if (telefono === null) return;

    UI.setStatus('vacantes-status', 'loading', 'Guardando numero...');
    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/${id}/telefono`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefono }),
    });
    if (!res) return;

    if (res.ok) {
      UI.setStatus('vacantes-status', 'ok', telefono ? 'Numero guardado.' : 'Numero eliminado.');
      await loadVacantes();
    } else {
      const d = await res.json().catch(() => ({}));
      UI.setStatus('vacantes-status', 'error', d.error || 'Error al guardar numero');
    }
  }

  // ──────────────────────────
  // Region switch
  // ──────────────────────────
  async function loadCupones() {
    if (!FEATURES.coupons || state.region !== 'gdl') return;
    const grid = document.getElementById('cupones-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Cargando...</p>';
    try {
      const res = await fetch('/gdl/data/cupones.json');
      if (!res.ok) throw new Error();
      renderCuponesGrid(await res.json());
    } catch (_) {
      renderCuponesGrid([]);
    }
  }

  function renderCuponesGrid(data) {
    const grid = document.getElementById('cupones-grid');
    state.cupones = Array.isArray(data) ? data : [];
    document.getElementById('cupones-count').textContent = `${state.cupones.length} cupón(es) publicado(s)`;
    if (!state.cupones.length) {
      grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Sin cupones</p>';
      return;
    }

    grid.innerHTML = state.cupones.map(cupon => `
      <div class="admin-vacante-item admin-cupon-item" data-id="${escapeAttr(cupon.id)}" draggable="true">
        <img src="${mediaUrl('gdl', 'cupones', cupon.url)}" alt="Cupón" loading="lazy"
             style="transform:rotate(${Number(cupon.rotation) || 0}deg)" onerror="this.onerror=null;this.style.opacity='.3'">
        <span class="cupon-drag-handle" title="Arrastrar" aria-hidden="true">⠿</span>
        <button class="btn-rotate-cupon" data-id="${escapeAttr(cupon.id)}" type="button" title="Rotar 90°">↻</button>
        <button class="btn-delete-cupon" data-id="${escapeAttr(cupon.id)}" type="button" title="Eliminar">×</button>
      </div>
    `).join('');

    grid.querySelectorAll('.btn-rotate-cupon').forEach(btn => {
      btn.addEventListener('click', () => rotateCupon(btn.dataset.id));
    });
    grid.querySelectorAll('.btn-delete-cupon').forEach(btn => {
      btn.addEventListener('click', () => deleteCupon(btn.dataset.id));
    });
    initDragAndDrop(grid, 'cupones');
  }

  function sortedImages(files) {
    return Array.from(files)
      .filter(file => file.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }

  async function uploadCupones(files) {
    const images = sortedImages(files);
    for (let i = 0; i < images.length; i++) {
      UI.setStatus('cupones-status', 'loading', `Subiendo ${i + 1} de ${images.length}...`);
      const fd = new FormData();
      fd.append('imagen', images[i]);
      const res = await apiRequest('/soloofertas/gdl/cupones', { method: 'POST', body: fd });
      if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        UI.setStatus('cupones-status', 'error', data.error || 'Error al subir');
        return;
      }
    }
    UI.setStatus('cupones-status', 'ok', `${images.length} cupón(es) subido(s).`);
    await loadCupones();
  }

  async function replaceCarpetaCupones(files) {
    const images = sortedImages(files);
    if (!images.length) {
      UI.setStatus('cupones-status', 'error', 'No se encontraron imágenes en la carpeta');
      return;
    }
    if (!await UI.confirm(`¿Reemplazar todos los cupones con ${images.length} imágenes?\nEsta acción elimina los cupones actuales.`)) return;

    UI.setStatus('cupones-status', 'loading', `Subiendo ${images.length} imagen(es)...`);
    const fd = new FormData();
    images.forEach(file => fd.append('imagenes', file));
    const res = await apiRequest('/soloofertas/gdl/cupones/replace-all', { method: 'POST', body: fd });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      UI.setStatus('cupones-status', 'ok', `${data.total} cupón(es) reemplazado(s).`);
      await loadCupones();
    } else {
      UI.setStatus('cupones-status', 'error', data.error || 'Error al reemplazar');
    }
  }

  async function rotateCupon(id) {
    const res = await apiRequest(`/soloofertas/gdl/cupones/${id}/rotate`, { method: 'PUT' });
    if (!res) return;
    if (!res.ok) {
      UI.setStatus('cupones-status', 'error', 'Error al rotar');
      return;
    }
    const { rotation } = await res.json();
    const item = [...document.querySelectorAll('#cupones-grid .admin-cupon-item')].find(el => el.dataset.id === id);
    if (item) item.querySelector('img').style.transform = `rotate(${rotation}deg)`;
  }

  async function deleteCupon(id) {
    if (!await UI.confirm('¿Eliminar este cupón?')) return;
    const res = await apiRequest(`/soloofertas/gdl/cupones/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.ok) renderCuponesGrid(state.cupones.filter(cupon => cupon.id !== id));
    else UI.setStatus('cupones-status', 'error', 'Error al eliminar cupón');
  }

  function showAdminSection(section) {
    if (!['portada', 'vacantes'].includes(section)) section = 'portada';
    state.section = section;
    document.querySelectorAll('[data-admin-section]').forEach(button => {
      button.classList.toggle('active', button.dataset.adminSection === section);
    });
    document.querySelectorAll('[data-admin-section-panel]').forEach(panel => {
      panel.hidden = panel.dataset.adminSectionPanel !== section;
    });
  }

  function setRegion(region) {
    state.region = region;
    document.querySelectorAll('.region-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.region === region);
    });
    UI.clearStatus('portada-status');
    UI.clearStatus('vacantes-status');
    UI.clearStatus('cupones-status');
    document.querySelectorAll('[data-feature-coupons]').forEach(el => {
      el.hidden = !FEATURES.coupons || region !== 'gdl';
    });
    showAdminSection(state.section);
    loadPortada();
    loadVacantes();
    if (FEATURES.coupons && region === 'gdl') loadCupones();
  }

  // ──────────────────────────
  // Init
  // ──────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    if (Auth.isAuthenticated()) {
      UI.showPanel();
      loadPortada();
      loadVacantes();
      if (FEATURES.coupons) loadCupones();
    } else {
      UI.showLogin();
    }

    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-login');
      const errEl = document.getElementById('login-error');
      const usuario = document.getElementById('login-usuario').value.trim();
      const password = document.getElementById('login-password').value;

      btn.disabled = true;
      btn.textContent = 'Entrando...';
      errEl.textContent = '';

      try {
        await Auth.login(usuario, password);
        UI.showPanel();
        loadPortada();
        loadVacantes();
        if (FEATURES.coupons) loadCupones();
      } catch (err) {
        errEl.textContent = err.message || 'Credenciales incorrectas';
      } finally {
        btn.disabled = false;
        btn.textContent = 'ENTRAR';
      }
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
      Auth.logout();
      UI.showLogin();
    });

    document.getElementById('btn-backup').addEventListener('click', downloadBackup);
    document.getElementById('input-backup').addEventListener('change', event => {
      restoreBackup(event.target.files[0]);
    });

    // Region selector
    document.querySelectorAll('.region-btn').forEach(btn => {
      btn.addEventListener('click', () => setRegion(btn.dataset.region));
    });

    document.querySelectorAll('[data-admin-section]').forEach(btn => {
      btn.addEventListener('click', () => showAdminSection(btn.dataset.adminSection));
    });

    // Portada upload
    document.getElementById('input-portada').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) uploadPortada(file);
      e.target.value = '';
    });

    // Vacantes upload
    document.getElementById('input-vacantes').addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length) uploadVacantes(files);
      e.target.value = '';
    });

    // Vacantes replace-all (carpeta)
    document.getElementById('input-vacantes-carpeta').addEventListener('change', (e) => {
      const files = e.target.files;
      if (files.length) replaceCarpetaVacantes(files);
      e.target.value = '';
    });

    if (FEATURES.coupons) {
      document.getElementById('input-cupones').addEventListener('change', (e) => {
        if (e.target.files.length) uploadCupones(e.target.files);
        e.target.value = '';
      });

      document.getElementById('input-cupones-carpeta').addEventListener('change', (e) => {
        if (e.target.files.length) replaceCarpetaCupones(e.target.files);
        e.target.value = '';
      });
    }
  });
})();
