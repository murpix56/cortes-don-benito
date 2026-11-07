/* Red de seguridad: si la aplicación no llega a arrancar (p. ej. por una versión antigua guardada en el
 * navegador), en lugar de una página en blanco se muestra un aviso con un botón para limpiar y recargar. */
(function () {
  function mostrar() {
    if (window.__appListo || document.getElementById('fallo')) return;
    var d = document.createElement('div'); d.id = 'fallo';
    d.setAttribute('style', 'position:fixed;inset:0;z-index:99999;background:#0f2a4a;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif;text-align:center');
    d.innerHTML = '<div style="max-width:360px"><div style="font-size:19px;font-weight:700;margin-bottom:8px">No se ha podido cargar la aplicación</div>' +
      '<p style="opacity:.8;margin:0 0 18px;line-height:1.4">Suele deberse a una versión antigua guardada en este dispositivo. Pulsa el botón para actualizarla.</p>' +
      '<button id="frec" style="background:#fff;color:#0f2a4a;border:0;border-radius:12px;padding:13px 22px;font-size:16px;font-weight:700;cursor:pointer">Recargar y actualizar</button></div>';
    document.body.appendChild(d);
    document.getElementById('frec').onclick = function () {
      var fin = function () { location.replace(location.pathname + '?r=' + Date.now() + location.hash); };
      try {
        Promise.all([
          navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }) : 0,
          window.caches ? caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }) : 0,
        ]).then(fin, fin);
      } catch (e) { fin(); }
    };
  }
  window.addEventListener('error', function () { if (!window.__appListo) setTimeout(mostrar, 400); });
  setTimeout(mostrar, 7000);
})();
