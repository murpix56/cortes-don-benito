const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'); const C = require('./common');
const ROOT = process.argv[2] || path.resolve(__dirname, '..');
// servidor estático "tipo GitHub Pages": sin /api, cabecera max-age=600
const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/cortes-don-benito/' ) p = '/index.html'; p = p.replace(/^\/cortes-don-benito/, '');
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e || p.startsWith('/servidor') || p.startsWith('/.git')) { r.writeHead(404, { 'Content-Type': 'text/html' }); r.end('<h1>404</h1>'); } else { const t = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/json' }[p.split('.').pop()] || 'application/octet-stream'; r.writeHead(200, { 'Content-Type': t, 'Cache-Control': 'max-age=600' }); r.end(d); } }); }).listen(8860);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 780 } }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console: ' + m.text()); });
  await C.mockNet(page);
  // datos antiguos de versiones anteriores
  await page.addInitScript(() => { if (!localStorage.getItem('cortes.v1')) localStorage.setItem('cortes.v1', JSON.stringify([
    { id: 'old1', calle: 'Calle Vieja', tramo: '', tipo: 'sentido', motivo: 'Mercadillo / feria', organismo: 'Empresa de obras', autoriza: 'Otro organismo', inicio: '2026-11-01T08:00', fin: '2099-01-01T08:00', desvio: '', publicado: true, segs: [[[38.9545, -5.864], [38.9545, -5.862]]] },
    { id: 'old2', calle: 'Sin fecha', tipo: 'total', inicio: '2026-11-02T08:00', fin: '', segs: [[[38.9554, -5.864], [38.9554, -5.862]]] }])); });
  for (const hash of ['', '#/ciudadano', '#/agente']) {
    await page.goto('http://localhost:8860/cortes-don-benito/' + hash); await page.waitForTimeout(1200);
    const info = await page.evaluate(() => ({ modo: document.body.dataset.mode, panel: document.querySelector('#panelBody').innerText.slice(0, 80).replace(/\n/g, ' | '), landing: !document.querySelector('#landing').hidden }));
    console.log((hash || '(portada)').padEnd(12), JSON.stringify(info));
  }
  await page.waitForTimeout(800); const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? (r.active ? 'activo' : 'instalando') : 'sin SW'; });
  console.log('service worker:', sw, '| errores:', JSON.stringify(errs)); await b.close(); srv.close();
})();
