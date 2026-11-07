/* Pruebas de aceptación del servidor (permisos, auditoría, seguridad). Uso:  node servidor/pruebas.mjs
 * Crea una base de datos TEMPORAL y un servidor en el puerto 8801; no toca los datos reales. */
import { spawn, execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { DatabaseSync } from 'node:sqlite';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), DB = path.join(os.tmpdir(), 'cortes-pruebas.db'), PORT = 8801, B = `http://127.0.0.1:${PORT}`;
for (const f of [DB]) try { fs.unlinkSync(f); } catch {}
const env = { ...process.env, DB_PATH: DB, PORT: String(PORT), WEB_DIR: R };
const cli = (...a) => execFileSync('node', [R + '/servidor/usuarios.mjs', ...a], { env: { ...env, CORTES_CLAVE: 'Clave-Temporal-2026' } }).toString().trim();
console.log(cli('crear', 'informatica', 'tic', 'Informática Ayuntamiento')); console.log(cli('crear', 'mando1', 'mando', 'Subinspector')); console.log(cli('crear', 'agente1', 'agente', 'Agente de servicio'));
const srv = spawn('node', [R + '/servidor/server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
process.on('exit', () => { try { srv.kill(); } catch {} });
await new Promise(ok => srv.stdout.on('data', d => String(d).includes('escuchando') && ok()));
let ok = 0, ko = 0; const t = (n, c, extra = '') => { c ? ok++ : ko++; console.log((c ? '  ✔ ' : '  ✘ FALLO: ') + n + (extra && !c ? '  → ' + extra : '')); };
class Cli { constructor() { this.ck = ''; }
  async f(m, p, body, h = {}) { const r = await fetch(B + p, { method: m, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.ck ? { Cookie: this.ck } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.ck = sc.split(';')[0].replace(/^sid=$/, ''); let j = null; const x = await r.text(); try { j = JSON.parse(x); } catch {} return { s: r.status, j, h: r.headers, x }; } }
const UU = n => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;
const corte = (n, o = {}) => ({ id: UU(n), calle: 'Calle Prueba ' + n, tramo: 'entre A y B', tipo: 'total', motivo: 'Obra', organismo: 'Ayuntamiento', autoriza: 'Ayuntamiento', autoriza_detalle: 'Decreto 1', referencia: 'EXP-INTERNO', obs: 'NOTA-SECRETA', inicio: '2026-11-07T08:00', fin: '2099-01-01T08:00', desvio: 'Por la paralela', publicado: true, segs: [[[38.95, -5.86], [38.951, -5.861]]], ...o });
console.log('\n[Estado, estáticos y cabeceras]');
let a = new Cli(); let r = await a.f('GET', '/api/estado'); t('estado público', r.j.app === 'cortes');
t('cabeceras de seguridad (CSP, nosniff, DENY)', !!r.h.get('content-security-policy') && r.h.get('x-content-type-options') === 'nosniff' && r.h.get('x-frame-options') === 'DENY');
for (const p of ['/index.html', '/js/app.js', '/style.css', '/vendor/leaflet/leaflet.js']) t('sirve ' + p, (await a.f('GET', p)).s === 200);
for (const p of ['/servidor/server.mjs', '/servidor/datos/cortes.db', '/.git/config', '/js/../servidor/lib.mjs', '/%2e%2e/etc/passwd', '/README.md', '/servidor/', '/package.json']) { const x = await a.f('GET', p); t('NO sirve ' + p, x.s === 404, x.s); }
console.log('\n[Acceso]');
r = await a.f('GET', '/api/cortes'); t('sin sesión: /api/cortes → 401', r.s === 401);
r = await a.f('POST', '/api/login', { usuario: 'agente1', clave: 'mala' }); t('clave incorrecta → 401 genérico', r.s === 401 && r.j.error === 'Usuario o contraseña incorrectos');
r = await a.f('POST', '/api/login', { usuario: 'noexiste', clave: 'x' }); t('usuario inexistente → mismo mensaje', r.s === 401 && r.j.error === 'Usuario o contraseña incorrectos');
r = await a.f('POST', '/api/login', { usuario: 'agente1', clave: 'Clave-Temporal-2026' }); t('login correcto', r.s === 200 && r.j.rol === 'agente' && r.j.cambiar_clave === true);
t('cookie HttpOnly + SameSite=Strict', /HttpOnly/i.test(r.h.get('set-cookie')) && /SameSite=Strict/i.test(r.h.get('set-cookie')));
r = await a.f('GET', '/api/cortes'); t('con clave temporal: bloqueado hasta cambiarla (403)', r.s === 403);
r = await a.f('POST', '/api/yo/clave', { actual: 'Clave-Temporal-2026', nueva: 'corta1' }); t('clave débil rechazada', r.s === 400, r.x);
r = await a.f('POST', '/api/yo/clave', { actual: 'Clave-Temporal-2026', nueva: 'Paloma-Verde-2026' }); t('cambio de clave', r.s === 200);
r = await a.f('GET', '/api/cortes'); t('tras cambiarla: accede', r.s === 200 && Array.isArray(r.j));
console.log('\n[Agente: crear, importar, publicar, borrar]');
r = await a.f('POST', '/api/cortes', { cortes: [corte(1)] }); t('crea corte publicado', r.s === 200, r.x);
r = await a.f('POST', '/api/cortes', { cortes: [corte(2, { autoriza: '', publicado: true })] }); t('publicar sin "autoriza" → 400', r.s === 400, r.x);
r = await a.f('POST', '/api/cortes', { cortes: [corte(3, { publicado: false, autoriza: '', origen: 'importado' })], lote: { tipo: 'importacion', archivo: 'vinfopol.xlsx', filas: 5 } }); t('importación sin publicar (sin autoriza)', r.s === 200, r.x);
for (const [n, mal] of [['tipo inválido', { tipo: 'xx' }], ['fechas invertidas', { fin: '2020-01-01T00:00' }], ['id no uuid', { id: 'abc' }], ['trazado vacío', { segs: [] }], ['coordenadas no numéricas', { segs: [[['a', 'b'], [1, 2]]] }], ['calle gigante', { calle: 'x'.repeat(500) }]]) { r = await a.f('POST', '/api/cortes', { cortes: [corte(9, mal)] }); t('rechaza ' + n, r.s === 400, r.x); }
r = await a.f('POST', '/api/cortes', { cortes: [{ ...corte(1), calle: 'Calle Editada', _base: 'caducado' }] }); t('conflicto de edición simultánea → 409', r.s === 409, r.x);
const lista = (await a.f('GET', '/api/cortes')).j; const c1 = lista.find(c => c.id === UU(1));
r = await a.f('POST', '/api/cortes', { cortes: [{ ...corte(1), calle: 'Calle Editada', tipo: 'parcial', _base: c1.modificado }] }); t('edita con la versión correcta', r.s === 200, r.x);
t('agente NO ve auditoría', (await a.f('GET', '/api/auditoria')).s === 403); t('agente NO gestiona usuarios', (await a.f('GET', '/api/usuarios')).s === 403);
t('agente NO descarga copia', (await a.f('GET', '/api/copia')).s === 403); t('agente NO ve sistema', (await a.f('GET', '/api/sistema')).s === 403);
r = await a.f('POST', '/api/cortes', { cortes: [corte(4, { publicado: false })] }); r = await a.f('DELETE', `/api/cortes/${UU(4)}`); t('agente borra (queda auditado, recuperable)', r.s === 200);
t('el borrado no sale en su lista', !(await a.f('GET', '/api/cortes')).j.some(c => c.id === UU(4)));
t('agente NO restaura', (await a.f('POST', `/api/cortes/${UU(4)}/restaurar`, {})).s === 403);
console.log('\n[Ciudadano: vista pública]');
const p = new Cli(); r = await p.f('GET', '/api/publico'); const pub = r.j;
t('ve el corte publicado', pub.some(c => c.id === UU(1)) && pub.length === 1, JSON.stringify(pub.map(c => c.id)));
t('NO ve el no publicado ni el borrado', !pub.some(c => [UU(3), UU(4)].includes(c.id)));
t('NO hay campos internos (obs, referencia, creado_por, firma)', !/NOTA-SECRETA|EXP-INTERNO|creado_por|modificado_por|firma|publicado"/.test(r.x), r.x.slice(0, 200));
t('ciudadano no puede escribir ni leer cortes', (await p.f('POST', '/api/cortes', { cortes: [corte(5)] })).s === 401 && (await p.f('GET', '/api/cortes')).s === 401);
r = await a.f('POST', '/api/cortes', { cortes: [corte(6, { fin: '2020-01-01T10:00', inicio: '2020-01-01T08:00' })] }); t('finalizado hace >2 días no sale en lo público', !(await p.f('GET', '/api/publico')).j.some(c => c.id === UU(6)));
console.log('\n[Mando: auditoría, restauración, usuarios]');
const m = new Cli(); await m.f('POST', '/api/login', { usuario: 'mando1', clave: 'Clave-Temporal-2026' }); await m.f('POST', '/api/yo/clave', { actual: 'Clave-Temporal-2026', nueva: 'Roble-Azul-2026' });
r = await m.f('GET', '/api/auditoria'); const au = r.j; t('mando ve la auditoría', r.s === 200 && au.length > 5);
const acc = new Set(au.map(x => x.accion)); t('registra: alta, edición, importación, borrado, login, fallo de login, cambio de clave', ['CORTE_ALTA', 'CORTE_EDICION', 'IMPORTACION', 'CORTE_BORRADO', 'LOGIN', 'LOGIN_FALLIDO', 'CLAVE_CAMBIO'].every(x => acc.has(x)), [...acc].join(','));
const imp = au.find(x => x.accion === 'IMPORTACION'); t('la importación indica archivo, usuario y nº', /vinfopol\.xlsx/.test(imp.detalle) && imp.usuario === 'agente1' && imp.ip, JSON.stringify(imp));
const ed = au.find(x => x.accion === 'CORTE_EDICION' && x.usuario === 'agente1'); t('la edición detalla qué cambió', /calle:.*Calle Editada/.test(ed.detalle) && /tipo:/.test(ed.detalle), ed.detalle);
const bor = au.find(x => x.accion === 'CORTE_BORRADO'); t('el borrado indica quién (agente1) y es restaurable', bor.usuario === 'agente1' && bor.restaurable === true);
r = await m.f('POST', `/api/cortes/${UU(4)}/restaurar`, {}); t('mando restaura el corte borrado', r.s === 200); t('…vuelve SIN publicar a la lista del agente', (await a.f('GET', '/api/cortes')).j.some(c => c.id === UU(4) && c.publicado === false));
r = await m.f('GET', '/api/auditoria/verificar'); t('cadena de auditoría íntegra', r.j.ok === true && r.j.total > 5, JSON.stringify(r.j));
r = await m.f('GET', '/api/usuarios'); t('mando solo ve agentes', r.j.every(u => u.rol === 'agente') && r.j.length === 1);
r = await m.f('POST', '/api/usuarios', { usuario: 'agente2', nombre: 'Otro agente', rol: 'agente', clave: 'Temporal-Otro-26' }); t('mando crea un agente', r.s === 200, r.x);
r = await m.f('POST', '/api/usuarios', { usuario: 'jefe2', nombre: 'X', rol: 'mando', clave: 'Temporal-Jefe2-26' }); t('mando NO crea mandos (403)', r.s === 403);
t('mando descarga copia', (await m.f('GET', '/api/copia')).s === 200); t('mando NO ve "sistema" (es de Informática)', (await m.f('GET', '/api/sistema')).s === 403);
console.log('\n[Informática]');
const i = new Cli(); await i.f('POST', '/api/login', { usuario: 'informatica', clave: 'Clave-Temporal-2026' }); await i.f('POST', '/api/yo/clave', { actual: 'Clave-Temporal-2026', nueva: 'Tic-Nueva-Clave-26' });
t('tic NO ve ni toca cortes', (await i.f('GET', '/api/cortes')).s === 403 && (await i.f('POST', '/api/cortes', { cortes: [corte(7)] })).s === 403);
t('tic NO ve la auditoría (contenido)', (await i.f('GET', '/api/auditoria')).s === 403);
r = await i.f('GET', '/api/sistema'); t('tic ve estado del sistema y la integridad', r.s === 200 && r.j.integridad.ok === true && r.j.usuarios >= 4);
r = await i.f('GET', '/api/usuarios'); t('tic ve todos los usuarios', r.j.length >= 4);
const ag1 = r.j.find(u => u.usuario === 'agente1');
r = await i.f('PATCH', `/api/usuarios/${ag1.id}`, { clave: 'Reset-Clave-2026' }); t('tic restablece contraseña', r.s === 200); t('…y la sesión del agente queda cerrada', (await a.f('GET', '/api/cortes')).s === 401);
r = await i.f('PATCH', `/api/usuarios/${(await i.f('GET', '/api/usuarios')).j.find(u => u.usuario === 'informatica').id}`, { activo: false }); t('no puede desactivarse a sí mismo', r.s === 400);
console.log('\n[Seguridad]');
r = await a.f('POST', '/api/login', { usuario: 'agente2', clave: 'Temporal-Otro-26' }, { Origin: 'https://sitio-malicioso.example' }); t('rechaza peticiones con Origin ajeno (CSRF)', r.s === 403, r.s);
const z = new Cli(); let s429 = 0, s401 = 0; for (let k = 0; k < 7; k++) { const x = await z.f('POST', '/api/login', { usuario: 'agente2', clave: 'incorrecta' + k }); if (x.s === 429) s429++; if (x.s === 401) s401++; }
t('bloqueo de cuenta tras 5 fallos', s401 === 5 && s429 === 2, `${s401}/${s429}`);
r = await z.f('POST', '/api/login', { usuario: 'agente2', clave: 'Temporal-Otro-26' }); t('…ni siquiera con la clave correcta mientras dura el bloqueo', r.s === 429);
r = await z.f('POST', '/api/cortes', 'x'.repeat(10), {}); t('JSON roto → 400/401 sin caer', [400, 401, 415].includes(r.s));
const big = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'y'.repeat(7e6) }) }).then(x => x.status).catch(() => 'cortada'); t('cuerpo de 7 MB rechazado/cortado', big === 413 || big === 'cortada', big);
console.log('\n[Manipulación de la auditoría]');
srv.kill(); await new Promise(r => setTimeout(r, 300));
const d = new DatabaseSync(DB); d.prepare("update auditoria set usuario='otra-persona' where accion='CORTE_BORRADO'").run(); d.close();
const srv2 = spawn('node', [R + '/servidor/server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] }); await new Promise(ok => srv2.stdout.on('data', d => String(d).includes('escuchando') && ok()));
const m2 = new Cli(); await m2.f('POST', '/api/login', { usuario: 'mando1', clave: 'Roble-Azul-2026' }); r = await m2.f('GET', '/api/auditoria/verificar');
t('SE DETECTA que alguien editó un registro a mano en la base de datos', r.j.ok === false && r.j.fallo_en > 0, JSON.stringify(r.j));
srv2.kill(); console.log(`\n${ok} correctas, ${ko} con fallo`); process.exit(ko ? 1 : 0);
