(function () {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function getVal(id) {
    return (document.getElementById(id) || {}).value || '';
  }

  function setError(field, msg) {
    const input = document.getElementById(field);
    const err = document.getElementById(`error-${field}`);
    if (input) input.classList.toggle('input-error', !!msg);
    if (err) err.textContent = msg || '';
  }

  function clearErrors() {
    ['nombre', 'email', 'asunto'].forEach(f => setError(f, ''));
  }

  function validate() {
    let ok = true;
    const nombre = getVal('nombre').trim();
    const email = getVal('email').trim();
    const asunto = getVal('asunto').trim();

    if (!nombre) { setError('nombre', 'El nombre es requerido'); ok = false; }
    if (!email || !EMAIL_RE.test(email)) { setError('email', 'Ingresa un correo válido'); ok = false; }
    if (!asunto) { setError('asunto', 'El asunto es requerido'); ok = false; }
    return ok;
  }

  function showFeedback(type, msg) {
    const el = document.getElementById('form-feedback');
    if (!el) return;
    el.className = type === 'ok' ? 'feedback-ok' : 'feedback-error';
    el.textContent = msg;
  }

  function hideFeedback() {
    const el = document.getElementById('form-feedback');
    if (el) { el.className = ''; el.textContent = ''; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contacto-form');
    const btn = document.getElementById('btn-enviar');
    if (!form || !btn) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideFeedback();
      clearErrors();

      if (!validate()) return;

      btn.disabled = true;
      btn.textContent = 'Enviando...';

      const payload = {
        nombre: getVal('nombre').trim(),
        email: getVal('email').trim(),
        asunto: getVal('asunto').trim(),
        mensaje: getVal('mensaje').trim(),
      };

      try {
        const res = await fetch('/soloofertas/contacto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          showFeedback('ok', 'Mensaje enviado. Te contactaremos pronto.');
          form.reset();
          clearErrors();
        } else {
          showFeedback('error', 'Hubo un error al enviar. Intenta de nuevo.');
        }
      } catch (_) {
        showFeedback('error', 'Sin conexión. Intenta de nuevo.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'ENVIAR';
      }
    });
  });
})();
