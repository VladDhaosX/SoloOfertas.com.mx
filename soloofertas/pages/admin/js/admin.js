(function () {
  const state = {
    token: localStorage.getItem('se_token'),
    region: 'gdl',
  };

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
  };

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
      img.src = `${data.url}?v=${data.version}`;
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
      grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Sin vacantes</p>';
    }
  }

  function renderVacantesGrid(data) {
    const grid = document.getElementById('vacantes-grid');
    if (!data.length) {
      grid.innerHTML = '<p style="color:#aaa;font-size:.85rem">Sin vacantes</p>';
      return;
    }
    grid.innerHTML = data.map(v => {
      const rot = Number(v.rotation) || 0;
      const rotStyle = rot ? ` style="transform:rotate(${rot}deg)"` : '';
      return `
      <div class="admin-vacante-item" data-id="${v.id}" data-rotation="${rot}" draggable="true">
        <img src="${v.url}" alt="Vacante" loading="lazy"${rotStyle}
             onerror="this.onerror=null;this.style.opacity='.3'">
        <button class="btn-rotate-vacante" data-id="${v.id}" title="Rotar">&#8635;</button>
        <button class="btn-delete-vacante" data-id="${v.id}" title="Eliminar">&#10005;</button>
      </div>
    `;
    }).join('');

    grid.querySelectorAll('.btn-delete-vacante').forEach(btn => {
      btn.addEventListener('click', () => deleteVacante(btn.dataset.id));
    });

    initDragAndDrop(grid);
  }

  function saveOrder(grid) {
    const ids = [...grid.querySelectorAll('.admin-vacante-item')].map(el => el.dataset.id);
    apiRequest(`/soloofertas/${state.region}/vacantes/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  }

  function reorderItems(grid, src, target) {
    const items = [...grid.querySelectorAll('.admin-vacante-item')];
    const srcIdx = items.indexOf(src);
    const dstIdx = items.indexOf(target);
    if (srcIdx < dstIdx) target.after(src);
    else target.before(src);
    saveOrder(grid);
  }

  function initDragAndDrop(grid) {
    let dragging = null;

    // Desktop — HTML5 DnD
    grid.querySelectorAll('.admin-vacante-item').forEach(item => {
      item.addEventListener('dragstart', () => {
        dragging = item;
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
        dragging = null;
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragging && item !== dragging) {
          grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
          item.classList.add('drag-over');
        }
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragging && item !== dragging) {
          item.classList.remove('drag-over');
          reorderItems(grid, dragging, item);
        }
      });
    });

    // Mobile — touch events
    grid.querySelectorAll('.admin-vacante-item').forEach(item => {
      let clone = null;

      item.addEventListener('touchstart', (e) => {
        dragging = item;
        item.classList.add('dragging');
        const t = e.touches[0];
        clone = item.cloneNode(true);
        clone.style.cssText = `position:fixed;z-index:9999;opacity:0.75;pointer-events:none;width:${item.offsetWidth}px;left:${t.clientX - item.offsetWidth / 2}px;top:${t.clientY - item.offsetHeight / 2}px;`;
        document.body.appendChild(clone);
      }, { passive: true });

      item.addEventListener('touchmove', (e) => {
        if (!clone) return;
        const t = e.touches[0];
        clone.style.left = `${t.clientX - clone.offsetWidth / 2}px`;
        clone.style.top = `${t.clientY - clone.offsetHeight / 2}px`;

        clone.style.display = 'none';
        const el = document.elementFromPoint(t.clientX, t.clientY);
        clone.style.display = '';

        const target = el && el.closest('.admin-vacante-item');
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
        if (target && target !== dragging) target.classList.add('drag-over');
      }, { passive: true });

      item.addEventListener('touchend', (e) => {
        if (clone) { clone.remove(); clone = null; }
        item.classList.remove('dragging');
        const t = e.changedTouches[0];
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const target = el && el.closest('.admin-vacante-item');
        grid.querySelectorAll('.admin-vacante-item').forEach(i => i.classList.remove('drag-over'));
        if (target && target !== dragging) reorderItems(grid, dragging, target);
        dragging = null;
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
    UI.setStatus('vacantes-status', 'ok', `${total} vacante(s) subida(s).`);
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

    if (!await UI.confirm(`¿Reemplazar todas las vacantes con ${images.length} imágenes?\nEsta acción elimina las vacantes actuales.`)) return;

    UI.setStatus('vacantes-status', 'loading', `Subiendo ${images.length} imagen(es)...`);
    const fd = new FormData();
    images.forEach(f => fd.append('imagenes', f));

    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/replace-all`, { method: 'POST', body: fd });
    if (!res) return;

    if (res.ok) {
      const d = await res.json();
      UI.setStatus('vacantes-status', 'ok', `${d.total} vacante(s) reemplazadas.`);
      await loadVacantes();
    } else {
      const d = await res.json().catch(() => ({}));
      UI.setStatus('vacantes-status', 'error', d.error || 'Error al reemplazar');
    }
  }

  async function deleteVacante(id) {
    if (!confirm('¿Eliminar esta vacante?')) return;
    const res = await apiRequest(`/soloofertas/${state.region}/vacantes/${id}`, { method: 'DELETE' });
    if (!res) return;
    if (res.ok) {
      const item = document.querySelector(`.admin-vacante-item[data-id="${id}"]`);
      if (item) item.remove();
    } else {
      alert('Error al eliminar vacante');
    }
  }

  // ──────────────────────────
  // Region switch
  // ──────────────────────────
  function setRegion(region) {
    state.region = region;
    document.querySelectorAll('.region-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.region === region);
    });
    UI.clearStatus('portada-status');
    UI.clearStatus('vacantes-status');
    loadPortada();
    loadVacantes();
  }

  // ──────────────────────────
  // Init
  // ──────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    if (Auth.isAuthenticated()) {
      UI.showPanel();
      loadPortada();
      loadVacantes();
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

    // Region selector
    document.querySelectorAll('.region-btn').forEach(btn => {
      btn.addEventListener('click', () => setRegion(btn.dataset.region));
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
  });
})();
