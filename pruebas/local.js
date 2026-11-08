const { chromium } = require('playwright'); const C = require('./common'); const SC = __dirname;
const srv = C.serve(8770); const errors = []; const out = (...a) => console.log(...a);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await C.mockNet(page);
  await page.goto('http://localhost:8770/index.html');
  await page.waitForSelector('.lbox');
  out('portada:', (await page.textContent('.lbox h1')).replace(/\s+/g, ' '), '| escudo fallback:', await page.locator('.landing .escudo.fallback').count());
  await page.screenshot({ path: SC + '/01-portada.png' });
  // —— Agente
  await page.click('a[href="#/agente"]');
  await page.waitForFunction(() => window.__cortes.net.ready);
  out('callejero cargado:', await page.evaluate(() => window.__cortes.net.ready), '| cintillo modo pruebas:', await page.locator('.ribbon').count());
  await page.evaluate(([a, b]) => window.__cortes.map.setView([a, b], 16, { animate: false }), C.ll(2, 2));
  const draw = async (a, b, pub, aut, extra = {}) => {
    await page.click('[data-act=new]'); await page.evaluate(([a, b]) => { window.__cortes.map.stop(); window.__cortes.map.setView([a, b], 16, { animate: false }); }, C.ll(2, 2)); await page.waitForTimeout(400);
    await C.clickGrid(page, a[0], a[1], [30, 8]); await C.clickGrid(page, b[0], b[1], [-30, -8]); await page.click('[data-act=next]');
    if (extra.noAut) { await page.click('button[type=submit]'); await page.waitForTimeout(150); out('  sin autoriza, sigue en formulario:', await page.locator('#f').count() === 1); }
    await page.check('input[name=autoriza][value="' + aut + '"]');
    await page.click('details.more summary'); await page.fill('input[name=autoriza_detalle]', 'Decreto 77/2026'); await page.fill('input[name=referencia]', 'EXP-INTERNO-123'); await page.fill('textarea[name=obs]', 'NOTA-INTERNA-SECRETA');
    await page.fill('textarea[name=desvio]', 'Circular por la paralela'); if (!pub) await page.click('.switch');
    await page.click('button[type=submit]'); await page.waitForSelector('.dhead'); await page.waitForTimeout(700);
  };
  await draw([1, 0], [1, 3], true, 'Ayuntamiento', { noAut: true });
  await page.click('details.more >> nth=0'); out('detalle agente:', (await page.textContent('#panelBody')).replace(/\s+/g, ' ').slice(0, 420));
  await page.screenshot({ path: SC + '/02-agente-detalle.png' });
  await page.click('[data-act=back]');
  await draw([3, 0], [3, 3], false, 'Policía Local');
  await page.click('[data-act=back]');
  await page.screenshot({ path: SC + '/03-agente-lista.png' });
  out('agente ve', await page.locator('#listItems .row').count(), 'cortes; stats:', (await page.locator('.sumline').first().textContent()).replace(/\s+/g, ' '), '| sin publicar badges:', await page.locator('.flag.bad').count());
  // —— Ciudadano
  await page.evaluate(() => { location.hash = '#/ciudadano'; });
  await page.waitForSelector('.fhead'); await page.click('.tg'); await page.waitForSelector('.frow');
  const ctext = await page.textContent('#panelBody');
  out('ciudadano ve', await page.locator('.frow').count(), 'corte(s); cabecera:', (await page.textContent('.fhead')).replace(/\s+/g, ' '));
  out('  ¿fuga de notas internas?', /NOTA-INTERNA|EXP-INTERNO|Sin publicar|Nuevo corte/.test(ctext), '| botón Nuevo corte:', await page.locator('[data-act=new]').count());
  await page.click('.frow >> nth=0'); await page.waitForSelector('.dhead'); await page.waitForTimeout(700);
  const det = (await page.textContent('#panelBody')).replace(/\s+/g, ' ');
  out('  detalle ciudadano contiene Autoriza/Desvío:', /Autoriza.*Ayuntamiento/.test(det), /Circular por la paralela/.test(det), '| fuga:', /NOTA-INTERNA|EXP-INTERNO|Editar|Eliminar/.test(det));
  await page.screenshot({ path: SC + '/04-ciudadano-detalle.png' });
  await page.click('[data-act=back]'); await page.screenshot({ path: SC + '/05-ciudadano-lista.png' });
  // —— Importación
  await page.evaluate(() => { location.hash = '#/agente'; });
  await page.waitForSelector('.tabs'); await page.waitForFunction(() => window.__cortes.net.ready);
  await page.click('[data-t=import]'); await page.setInputFiles('#fileTabla', SC + '/import.xlsx');
  await page.waitForSelector('[data-fmap=calle]');
  const mapped = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-fmap]')].map(s => [s.dataset.fmap, s.selectedOptions[0].textContent]).filter(x => x[1] !== '— no usar —')));
  out('columnas detectadas:', JSON.stringify(mapped));
  await page.screenshot({ path: SC + '/06-import-mapeo.png' });
  await page.click('[data-act=imp-run]'); await page.waitForSelector('.irow');
  const rows = await page.$$eval('.irow', r => r.map(x => x.className.replace('irow ', '') + ' | ' + x.querySelector('.t').textContent.trim() + ' | ' + x.querySelectorAll('.s')[1].textContent.trim()));
  rows.forEach(r => out('  fila:', r));
  await page.screenshot({ path: SC + '/07-import-resultado.png' });
  await page.click('[data-act=imp-go]'); await page.waitForSelector('#listItems .row, .cards .row');
  const st = await page.evaluate(() => window.__cortes.S.cortes.filter(c => c.origen === 'importado').map(c => `${c.calle} publicado=${c.publicado} segs=${c.segs.length} ini=${c.inicio}`));
  out('importados:', JSON.stringify(st));
  // CSV windows-1252 con ;
  await page.click('[data-t=import]'); await page.setInputFiles('#fileTabla', SC + '/import.csv'); await page.waitForSelector('[data-fmap=calle]');
  await page.click('[data-act=imp-run]'); await page.waitForSelector('.irow');
  out('CSV cp1252:', await page.$$eval('.irow', r => r.map(x => x.className + ' ' + x.querySelectorAll('.s')[0].textContent.trim().slice(0, 90))));
  await page.click('[data-act=imp-reset]');
  // Actividad y parte
  await page.click('[data-t=log]'); await page.waitForSelector('.item.static');
  out('actividad:', await page.locator('.item.static').count(), 'registros; primero:', (await page.locator('.item.static .t').first().textContent()).trim());
  await page.click('[data-t=cortes]'); await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.click('[data-act=print]'); await page.waitForTimeout(600);
  out('parte impreso:', await page.evaluate(() => window.__printed), '| filas parte:', await page.locator('#report tbody tr').count());
  // exportaciones
  await page.click('#btnMenu'); const [d1] = await Promise.all([page.waitForEvent('download'), page.click('[data-m=csv]')]);
  out('CSV export cabecera:', require('fs').readFileSync(await d1.path(), 'utf8').split('\r\n')[0].slice(0, 120));
  await browser.close(); srv.close(); out('ERRORES:', errors);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
