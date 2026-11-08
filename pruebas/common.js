const http = require('http'), fs = require('fs'), path = require('path');
exports.ROOT = require('path').resolve(__dirname, '..');
exports.serve = port => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(exports.ROOT, p), (e, d) => { if (e) { r.writeHead(404); r.end(); } else { const t = { html: 'text/html', js: 'text/javascript', css: 'text/css', png: 'image/png', webmanifest: 'application/json' }[p.split('.').pop()] || 'application/octet-stream'; r.writeHead(200, { 'Content-Type': t }); r.end(d); } });
}).listen(port);
exports.fake = (() => {
  const lat0 = 38.9545, lon0 = -5.8640, dl = 0.0009, dn = 0.0012, els = []; let id = 1; const nid = (i, j) => 1000 + i * 10 + j;
  for (let i = 0; i < 5; i++) { const nodes = [], geometry = []; for (let j = 0; j < 5; j++) { nodes.push(nid(i, j)); geometry.push({ lat: lat0 + i * dl, lon: lon0 + j * dn }); } els.push({ type: 'way', id: id++, nodes, geometry, tags: { highway: i === 2 ? 'secondary' : 'residential', name: 'Calle Este-Oeste ' + (i + 1) } }); }
  for (let j = 0; j < 5; j++) { const nodes = [], geometry = []; for (let i = 0; i < 5; i++) { nodes.push(nid(i, j)); geometry.push({ lat: lat0 + i * dl, lon: lon0 + j * dn }); } els.push({ type: 'way', id: id++, nodes, geometry, tags: { highway: 'residential', name: 'Calle Norte-Sur ' + (j + 1) } }); }
  return { elements: els, lat0, lon0, dl, dn };
})();
exports.PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
exports.mockNet = async page => {
  await page.route('**/overpass-api.de/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: exports.fake.elements }) }));
  await page.route('**/tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: exports.PNG }));
};
exports.ll = (i, j) => [exports.fake.lat0 + i * exports.fake.dl, exports.fake.lon0 + j * exports.fake.dn];
exports.clickGrid = async (page, i, j, off = [0, 0]) => {
  const [x, y] = await page.evaluate(([la, lo]) => { const m = window.__cortes.map, p = m.latLngToContainerPoint([la, lo]), r = m.getContainer().getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }, exports.ll(i, j));
  await page.mouse.click(x + off[0], y + off[1]); await page.waitForTimeout(200);
};
