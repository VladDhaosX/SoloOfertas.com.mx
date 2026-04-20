(function () {
  function showPlaceholder(imgId, placeholderId) {
    const img = document.getElementById(imgId);
    const ph = document.getElementById(placeholderId);
    if (img) img.style.display = 'none';
    if (ph) ph.style.display = 'flex';
  }

  async function loadPortada(region) {
    const imgId = `portada-${region}`;
    const phId = `placeholder-${region}`;
    try {
      const res = await fetch(`/${region}/data/portada.json`);
      if (!res.ok) throw new Error('no json');
      const data = await res.json();
      if (!data.url) throw new Error('no url');
      const img = document.getElementById(imgId);
      if (!img) return;
      img.onload = () => {};
      img.onerror = () => showPlaceholder(imgId, phId);
      img.src = `${data.url}?v=${data.version || Date.now()}`;
    } catch (_) {
      showPlaceholder(imgId, phId);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    Promise.all([loadPortada('gdl'), loadPortada('mty')]);
  });
})();
