const { chromium } = require('playwright'); const C = require('./common'); const SC = __dirname;
const srv = C.serve(8830); const errors = [];
(async () => {
  const browser = await chromium.launch();
  const mk = async vp => { const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', deviceScaleFactor: 2 }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); }); await C.mockNet(page); return page; };
  const pc = await mk({ width: 390, height: 780 });
  // datos de ejemplo directamente en el almacenamiento local (modo demostración)
  const ahora = new Date(); const L2 = n => String(n).padStart(2, '0'); const loc = d => `${d.getFullYear()}-${L2(d.getMonth() + 1)}-${L2(d.getDate())}T${L2(d.getHours())}:${L2(d.getMinutes())}`;
  const dm = new Date(ahora); dm.setDate(dm.getDate() + 1); dm.setHours(7, 0, 0, 0); const dp = new Date(ahora); dp.setDate(dp.getDate() + 1); dp.setHours(8, 30, 0, 0); const dp2 = new Date(dp); dp2.setHours(14, 0);
  const seg = (i, j0, j1) => [[C.ll(i, j0), C.ll(i, j1)]].map(p => p.map(q => [q[0], q[1]]))[0];
  const datos = [
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', calle: 'Plaza de las Albercas', tramo: '', tipo: 'total', motivo: 'Evento / procesión', organismo: '', autoriza: 'Policía Local', autoriza_detalle: '', referencia: 'EXP-1', obs: 'nota', inicio: loc(new Date(+ahora - 36e5)), fin: loc(dm), desvio: 'Circular por la calle Real', publicado: true, segs: [seg(1, 0, 3)], creado: ahora.toISOString(), modificado: ahora.toISOString() },
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002', calle: 'Calle Grízar', tramo: 'entre C/ Santa Marta y C/ Real', tipo: 'parcial', motivo: 'Obra', organismo: '', autoriza: 'Ayuntamiento', autoriza_detalle: 'Decreto 321/2026', referencia: '', obs: '', inicio: loc(new Date(+ahora - 864e5)), fin: loc(new Date(+ahora + 20 * 864e5)), desvio: '', publicado: true, segs: [seg(3, 0, 2)], creado: ahora.toISOString(), modificado: ahora.toISOString() },
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003', calle: 'Avenida de Extremadura', tramo: '', tipo: 'total', motivo: 'Mercadillo / feria', organismo: '', autoriza: 'Policía Local', autoriza_detalle: '', referencia: '', obs: '', inicio: loc(dp), fin: loc(dp2), desvio: '', publicado: false, segs: [seg(2, 1, 4)], creado: ahora.toISOString(), modificado: ahora.toISOString() },
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000004', calle: 'Calle Real', tramo: 'Entre Calle Norte-Sur 2 y Calle Norte-Sur 3', tipo: 'estac', lado: 'impares', motivo: 'Procesión', organismo: '', autoriza: 'Policía Local', autoriza_detalle: '', referencia: '', obs: '', inicio: loc(new Date(+ahora - 36e5)), fin: loc(dm), desvio: '', publicado: true, segs: [seg(4, 0, 2)], creado: ahora.toISOString(), modificado: ahora.toISOString() },
  ];
  datos[1].lado = 'pares';
  await pc.addInitScript(d => { if (!localStorage.getItem('cortes.v1')) localStorage.setItem('cortes.v1', JSON.stringify(d)); }, datos);
  await pc.goto('http://localhost:8830/index.html#/ciudadano'); await pc.waitForSelector('.fhead');
  await pc.evaluate(([a, b]) => window.__cortes.map.setView([a, b], 16, { animate: false }), C.ll(2, 2)); await pc.waitForTimeout(500);
  await pc.screenshot({ path: SC + '/30-ciudadano.png' });
  await pc.waitForTimeout(400); await pc.screenshot({ path: SC + '/30-ciudadano-recogido.png' }); console.log('al entrar la tarjeta está recogida:', (await pc.locator('.frow').count()) === 0, '| flecha:', await pc.$eval('.tg .chev', e => e.className || 'abajo')); await pc.click('.tg'); await pc.waitForSelector('.frow'); await pc.waitForTimeout(300);
  console.log('ciudadano filas:', await pc.$$eval('.frow', r => r.map(x => x.innerText.replace(/\n+/g, ' · '))));
  await pc.click('.frow >> nth=0'); await pc.waitForSelector('.dhead'); await pc.waitForTimeout(500); await pc.screenshot({ path: SC + '/32-ciudadano-ficha.png' });
  await pc.click('[data-act=back]'); await pc.waitForSelector('.frow'); await pc.screenshot({ path: SC + '/37-ciudadano-secciones.png' });
  await pc.fill('#cq', 'grizar'); await pc.waitForTimeout(600); await pc.screenshot({ path: SC + '/38-busqueda.png' });
  console.log('búsqueda «grizar»:', await pc.$$eval('.frow', r => r.map(x => x.innerText.replace(/\n+/g, ' · '))), '|', (await pc.textContent('.fhead')).replace(/\s+/g, ' '));
  await pc.fill('#cq', 'zzz'); await pc.waitForTimeout(500); console.log('búsqueda «zzz»:', (await pc.textContent('.fhead')).replace(/\s+/g, ' '), '|', (await pc.textContent('.okmsg')).trim());
  await pc.fill('#cq', ''); await pc.waitForTimeout(500);
  console.log('flecha con la lista abierta (debe ser hacia arriba):', await pc.$eval('.fhead .chev', e => e.className));
  await pc.click('.tg'); console.log('flecha con la lista cerrada (debe ser hacia abajo):', await pc.$eval('.fhead .chev', e => e.className));
  // agente (local)
  const pa = await mk({ width: 1280, height: 800 });
  await pa.addInitScript(d => { if (!localStorage.getItem('cortes.v1')) localStorage.setItem('cortes.v1', JSON.stringify(d)); }, datos);
  await pa.goto('http://localhost:8830/index.html#/agente'); await pa.waitForSelector('.ddb'); await pa.waitForFunction(() => window.__cortes.net.ready);
  await pa.evaluate(([a, b]) => window.__cortes.map.setView([a, b], 16, { animate: false }), C.ll(2, 2)); await pa.waitForTimeout(400);
  await pa.screenshot({ path: SC + '/33-agente-lista.png' });
  await pa.click('#periodo ~ .ddb'); await pa.click('.ddl li[data-v=todos]'); await pa.waitForTimeout(200); await pa.click('.cards .row >> nth=2'); await pa.waitForSelector('.dhead'); await pa.waitForTimeout(500); await pa.screenshot({ path: SC + '/34-agente-ficha.png' });
  await pa.click('[data-act=edit]'); await pa.waitForSelector('#f'); await pa.waitForTimeout(300); await pa.screenshot({ path: SC + '/35-agente-formulario.png' });
  await pa.click('#f .dd .ddb'); await pa.waitForTimeout(200); await pa.screenshot({ path: SC + '/40-desplegable-motivo.png' }); await pa.click('.ddl li[data-v=Procesión]'); console.log('motivo elegido:', await pa.inputValue('#motivo'));
  await pa.click('label:has(input[value=parcial])'); await pa.waitForTimeout(200); console.log('un solo carril → pide lado:', await pa.isVisible('#ladoBox'), '| «Ambos lados» oculto:', !(await pa.isVisible('[data-l=ambos]')));
  await pa.click('label:has(input[name=lado][value=pares])'); await pa.screenshot({ path: SC + '/41-un-solo-carril.png' });
  await pa.click('#btnPanel'); await pa.waitForTimeout(300); await pa.screenshot({ path: SC + '/42-panel-oculto.png' }); await pa.click('#pshow'); await pa.waitForTimeout(200);
  await pa.click('#btnMenu'); await pa.waitForTimeout(200); await pa.screenshot({ path: SC + '/43-menu.png' }); await pa.click('#btnMenu');
  await pa.click('[data-act=cancel]'); await pa.click('[data-act=back]'); await pa.click('[data-act=new]'); await pa.evaluate(([a, b]) => { window.__cortes.map.stop(); window.__cortes.map.setView([a, b], 16, { animate: false }); }, C.ll(2, 2)); await pa.waitForTimeout(400);
  await C.clickGrid(pa, 1, 0, [30, 8]); await C.clickGrid(pa, 1, 3, [-30, -8]); await pa.click('[data-act=next]'); await pa.waitForSelector('#f');
  console.log('tramo propuesto:', JSON.stringify(await pa.inputValue('input[name=tramo]')), '| calle propuesta:', JSON.stringify(await pa.inputValue('input[name=calle]')));
  const pm = await mk({ width: 390, height: 780 });
  await pm.addInitScript(d => { if (!localStorage.getItem('cortes.v1')) localStorage.setItem('cortes.v1', JSON.stringify(d)); }, datos);
  await pm.goto('http://localhost:8830/index.html#/agente'); await pm.waitForSelector('.ddb'); await pm.waitForTimeout(500); await pm.screenshot({ path: SC + '/36-agente-movil.png' });
  await browser.close(); srv.close(); console.log('ERRORES:', errors);
})().catch(e => { console.error('FALLO', e.message.split('\n').slice(0, 5).join('\n')); process.exit(1); });
