/* Servidor de cortes de calle · Policía Local de Don Benito
 * Sirve la aplicación web y la API. Requiere Node.js 22.13 o superior. Sin dependencias externas.
 * Configuración por variables de entorno (ver LEEME-INFORMATICA.md). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.TZ ||= 'Europe/Madrid';
import { abrirBD, hashClave, verificarClave, validarClave, sha, auditar, verificarAuditoria, limpiarCorte, diferencias, resumenCorte,
  PERMS, ROLES, ROL_NOMBRE, can, err, VERSION } from './lib.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = process.env;
const CFG = {
  port: +ENV.PORT || 8080, host: ENV.HOST || '127.0.0.1',
  db: ENV.DB_PATH || path.join(AQUI, 'datos', 'cortes.db'),
  web: path.resolve(ENV.WEB_DIR || path.join(AQUI, '..')),
  cookiePath: ENV.COOKIE_PATH || '/', secure: ENV.COOKIE_SECURE === '1', trustProxy: ENV.TRUST_PROXY === '1',
  horas: +ENV.SESSION_HOURS || 8, basePath: (ENV.BASE_PATH || '').replace(/\/+$/, ''),
};
const db = abrirBD(CFG.db);

/* ───────── Utilidades ───────── */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://www.ign.es; " +
  "connect-src 'self' https://overpass-api.de https://overpass.kumi.systems; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function cabecerasSeg(extra = {}) {
  const h = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()', 'Cross-Origin-Opener-Policy': 'same-origin', ...extra };
  if (CFG.secure) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}
const json = (res, status, obj, extra = {}) => { const b = obj === undefined ? '' : JSON.stringify(obj); res.writeHead(status, cabecerasSeg({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })); res.end(b); };
const ipDe = req => (CFG.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '';
function leerCuerpo(req, max = 6e6) {
  return new Promise((ok, ko) => {
    const partes = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { ko(err(413, 'Petición demasiado grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => { if (!n) return ok({}); try { ok(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { ko(err(400, 'JSON no válido')); } });
    req.on('error', ko);
  });
}
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, v.join('=')]));
const ahoraISO = (ms = 0) => new Date(Date.now() + ms).toISOString();
const localMin = ms => { const d = new Date(Date.now() + ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ───────── Sesiones y autenticación ───────── */
function sesionDe(req) {
  const sid = cookies(req).sid; if (!sid) return null;
  const th = sha(sid), s = db.prepare('select s.*, u.usuario, u.nombre, u.rol, u.cambiar_clave, u.activo from sesiones s join usuarios u on u.id = s.usuario_id where s.token_hash = ?').get(th);
  if (!s || !s.activo || s.expira < ahoraISO()) { if (s) db.prepare('delete from sesiones where token_hash = ?').run(th); return null; }
  if (Date.now() - Date.parse(s.ultima) > 60000) db.prepare('update sesiones set ultima = ?, expira = ? where token_hash = ?').run(ahoraISO(), ahoraISO(CFG.horas * 36e5), th);
  return { uid: s.usuario_id, usuario: s.usuario, nombre: s.nombre, rol: s.rol, cambiar_clave: !!s.cambiar_clave, ip: ipDe(req), th };
}
const cookieSesion = (token, maxAge) => `sid=${token}; HttpOnly; SameSite=Strict; Path=${CFG.cookiePath}; Max-Age=${maxAge}${CFG.secure ? '; Secure' : ''}`;
const fallosIP = new Map();
function limitarIP(ip) { const f = fallosIP.get(ip); if (f && f.n >= 20 && Date.now() - f.t < 15 * 60000) throw err(429, 'Demasiados intentos. Espera unos minutos.'); }
function anotarFallo(ip) { const f = fallosIP.get(ip); if (!f || Date.now() - f.t > 15 * 60000) fallosIP.set(ip, { n: 1, t: Date.now() }); else f.n++; }
const CLAVE_FALSA = hashClave('relleno-para-igualar-tiempos');

function login(req, res, b) {
  const ip = ipDe(req); limitarIP(ip);
  const u = db.prepare('select * from usuarios where usuario = ?').get(String(b.usuario || '').trim());
  const ctx = { usuario: String(b.usuario || '').slice(0, 60), rol: u && u.rol, ip };
  const fallo = (motivo) => { anotarFallo(ip); auditar(db, ctx, 'LOGIN_FALLIDO', { detalle: motivo }); throw err(401, 'Usuario o contraseña incorrectos'); };
  if (!u) { verificarClave(String(b.clave || ''), CLAVE_FALSA.salt, CLAVE_FALSA.hash); return fallo('usuario inexistente'); }
  if (!u.activo) return fallo('usuario desactivado');
  if (u.bloqueado_hasta && u.bloqueado_hasta > ahoraISO()) { auditar(db, ctx, 'LOGIN_FALLIDO', { detalle: 'cuenta bloqueada temporalmente' }); throw err(429, 'Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo en 15 minutos.'); }
  if (!verificarClave(String(b.clave || ''), u.salt, u.hash)) {
    const n = u.intentos + 1;
    db.prepare('update usuarios set intentos = ?, bloqueado_hasta = ? where id = ?').run(n >= 5 ? 0 : n, n >= 5 ? ahoraISO(15 * 60000) : null, u.id);
    return fallo(n >= 5 ? 'contraseña incorrecta; cuenta bloqueada 15 min' : 'contraseña incorrecta');
  }
  db.prepare('update usuarios set intentos = 0, bloqueado_hasta = null, ultimo_acceso = ? where id = ?').run(ahoraISO(), u.id);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('insert into sesiones(token_hash,usuario_id,creada,expira,ultima,ip) values(?,?,?,?,?,?)').run(sha(token), u.id, ahoraISO(), ahoraISO(CFG.horas * 36e5), ahoraISO(), ip);
  db.prepare('delete from sesiones where expira < ?').run(ahoraISO());
  auditar(db, { usuario: u.usuario, rol: u.rol, ip }, 'LOGIN');
  json(res, 200, yo({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, cambiar_clave: !!u.cambiar_clave }), { 'Set-Cookie': cookieSesion(token, CFG.horas * 3600) });
}
const yo = c => ({ usuario: c.usuario, nombre: c.nombre, rol: c.rol, rol_nombre: ROL_NOMBRE[c.rol], permisos: PERMS[c.rol], cambiar_clave: !!c.cambiar_clave });
function exigir(ctx, perm) {
  if (!ctx) throw err(401, 'Sesión caducada. Vuelve a entrar.');
  if (ctx.cambiar_clave) throw err(403, 'Debes cambiar la contraseña antes de continuar');
  if (perm && !(Array.isArray(perm) ? perm.some(p => can(ctx.rol, p)) : can(ctx.rol, perm))) throw err(403, 'No tienes permiso para esta acción');
}

/* ───────── Cortes ───────── */
const filaACorte = r => ({ id: r.id, ...JSON.parse(r.datos), publicado: !!r.publicado, creado: r.creado, creado_por: r.creado_por, modificado: r.modificado, modificado_por: r.modificado_por });
const PUBLICOS = ['id', 'calle', 'tramo', 'tipo', 'lado', 'motivo', 'organismo', 'autoriza', 'autoriza_detalle', 'inicio', 'fin', 'desvio', 'segs'];
function listarPublico() {
  const corte = localMin(-2 * 864e5);
  return db.prepare('select * from cortes where publicado = 1 and eliminado = 0').all().map(filaACorte)
    .filter(c => !c.fin || c.fin >= corte).map(c => Object.fromEntries(PUBLICOS.map(k => [k, c[k]])));
}
function guardarCortes(ctx, b) {
  if (!Array.isArray(b.cortes) || !b.cortes.length || b.cortes.length > 500) throw err(400, 'Lista de cortes no válida');
  const hechos = [];
  db.exec('BEGIN');
  try {
    for (const entrada of b.cortes) {
      const { id, publicado, datos } = limpiarCorte(entrada);
      const prev = db.prepare('select * from cortes where id = ?').get(id), ahora = ahoraISO();
      if (!prev) {
        exigir(ctx, 'cortes.crear'); if (publicado) exigir(ctx, 'cortes.publicar');
        db.prepare('insert into cortes(id,datos,publicado,eliminado,creado,creado_por,modificado,modificado_por) values(?,?,?,?,?,?,?,?)').run(id, JSON.stringify(datos), publicado ? 1 : 0, 0, ahora, ctx.usuario, ahora, ctx.usuario);
        auditar(db, ctx, 'CORTE_ALTA', { corte_id: id, calle: datos.calle, detalle: `${datos.origen === 'importado' ? 'Importado' : 'Manual'}${publicado ? ' · publicado' : ' · sin publicar'}${datos.autoriza ? ' · autoriza: ' + datos.autoriza : ''}`, datos: resumenCorte(datos) });
      } else {
        exigir(ctx, 'cortes.editar');
        if (prev.eliminado) throw err(409, 'Ese corte está eliminado. Un mando puede restaurarlo.');
        if (entrada._base && entrada._base !== prev.modificado) throw err(409, 'Otro usuario ha modificado este corte mientras lo editabas. Recarga e inténtalo de nuevo.');
        const antes = JSON.parse(prev.datos), dif = diferencias(antes, datos), cambioPub = !!prev.publicado !== publicado;
        if (cambioPub) exigir(ctx, 'cortes.publicar');
        db.prepare('update cortes set datos = ?, publicado = ?, modificado = ?, modificado_por = ? where id = ?').run(JSON.stringify({ ...datos, origen: antes.origen || datos.origen }), publicado ? 1 : 0, ahora, ctx.usuario, id);
        if (dif || !cambioPub) auditar(db, ctx, 'CORTE_EDICION', { corte_id: id, calle: datos.calle, detalle: dif || 'sin cambios en los datos', datos: resumenCorte(datos) });
        if (cambioPub) auditar(db, ctx, publicado ? 'CORTE_PUBLICADO' : 'CORTE_RETIRADO', { corte_id: id, calle: datos.calle });
      }
      hechos.push(id);
    }
    if (b.lote && b.lote.tipo === 'importacion') {
      exigir(ctx, 'cortes.importar');
      auditar(db, ctx, 'IMPORTACION', { detalle: `Archivo «${String(b.lote.archivo || '').slice(0, 120)}»: ${hechos.length} cortes cargados de ${+b.lote.filas || '?'} filas (sin publicar)` });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return hechos;
}

/* ───────── Usuarios ───────── */
const gestionables = ctx => (can(ctx.rol, 'usuarios.todos') ? ROLES : can(ctx.rol, 'usuarios.agentes') ? ['agente'] : []);
const usuarioPublico = u => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, rol_nombre: ROL_NOMBRE[u.rol], activo: !!u.activo, ultimo_acceso: u.ultimo_acceso, creado: u.creado, cambiar_clave: !!u.cambiar_clave });
function usuariosApi(ctx, req, m, b) {
  const permitidos = gestionables(ctx); if (!permitidos.length) throw err(403, 'No tienes permiso para esta acción');
  if (req.method === 'GET') return db.prepare('select * from usuarios order by usuario').all().filter(u => permitidos.includes(u.rol)).map(usuarioPublico);
  if (req.method === 'POST') {
    const usuario = String(b.usuario || '').trim(), nombre = String(b.nombre || '').trim();
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(usuario)) throw err(400, 'Usuario: 3-40 caracteres (letras, números, punto, guion)');
    if (!nombre || nombre.length > 100) throw err(400, 'Indica el nombre');
    if (!permitidos.includes(b.rol)) throw err(403, 'No puedes crear usuarios con ese perfil');
    const e = validarClave(b.clave, usuario); if (e) throw err(400, e);
    if (db.prepare('select 1 from usuarios where usuario = ?').get(usuario)) throw err(409, 'Ya existe ese usuario');
    const { salt, hash } = hashClave(b.clave);
    db.prepare('insert into usuarios(usuario,nombre,rol,salt,hash,activo,cambiar_clave,creado) values(?,?,?,?,?,1,1,?)').run(usuario, nombre, b.rol, salt, hash, ahoraISO());
    auditar(db, ctx, 'USUARIO_ALTA', { detalle: `${usuario} (${ROL_NOMBRE[b.rol]})` }); return { ok: true };
  }
  const u = db.prepare('select * from usuarios where id = ?').get(+m[1]);
  if (!u || !permitidos.includes(u.rol)) throw err(404, 'Usuario no encontrado');
  const cambios = [];
  if (b.activo !== undefined) {
    if (u.id === ctx.uid && !b.activo) throw err(400, 'No puedes desactivarte a ti mismo');
    db.prepare('update usuarios set activo = ? where id = ?').run(b.activo ? 1 : 0, u.id); cambios.push(b.activo ? 'activado' : 'desactivado');
    if (!b.activo) db.prepare('delete from sesiones where usuario_id = ?').run(u.id);
  }
  if (b.rol !== undefined && b.rol !== u.rol) {
    if (!permitidos.includes(b.rol)) throw err(403, 'No puedes asignar ese perfil'); if (u.id === ctx.uid) throw err(400, 'No puedes cambiar tu propio perfil');
    db.prepare('update usuarios set rol = ? where id = ?').run(b.rol, u.id); db.prepare('delete from sesiones where usuario_id = ?').run(u.id); cambios.push(`perfil ${u.rol} → ${b.rol}`);
  }
  if (b.clave !== undefined) {
    const e = validarClave(b.clave, u.usuario); if (e) throw err(400, e);
    const { salt, hash } = hashClave(b.clave);
    db.prepare('update usuarios set salt = ?, hash = ?, cambiar_clave = 1, intentos = 0, bloqueado_hasta = null where id = ?').run(salt, hash, u.id);
    db.prepare('delete from sesiones where usuario_id = ?').run(u.id); cambios.push('contraseña restablecida');
  }
  if (b.desbloquear) { db.prepare('update usuarios set intentos = 0, bloqueado_hasta = null where id = ?').run(u.id); cambios.push('desbloqueado'); }
  if (cambios.length) auditar(db, ctx, b.clave !== undefined ? 'CLAVE_RESTABLECIDA' : 'USUARIO_CAMBIO', { detalle: `${u.usuario}: ${cambios.join(', ')}` });
  return { ok: true };
}

/* ───────── API ───────── */
async function api(req, res, ruta, q) {
  const m = req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const o = req.headers.origin;
    if (o) { let h; try { h = new URL(o).host; } catch { h = ''; } if (h !== ((CFG.trustProxy && req.headers['x-forwarded-host']) || req.headers.host)) throw err(403, 'Origen no permitido'); }
    if (!String(req.headers['content-type'] || '').startsWith('application/json') && m !== 'DELETE' && ruta !== '/api/logout') throw err(415, 'Se esperaba JSON');
  }
  let mm;
  if (ruta === '/api/estado' && m === 'GET') return json(res, 200, { app: 'cortes', version: VERSION });
  if (ruta === '/api/publico' && m === 'GET') return json(res, 200, listarPublico());
  const b = (m === 'POST' || m === 'PATCH') ? await leerCuerpo(req) : {};
  if (ruta === '/api/login' && m === 'POST') return login(req, res, b);
  const ctx = sesionDe(req);
  if (ruta === '/api/logout' && m === 'POST') { if (ctx) { db.prepare('delete from sesiones where token_hash = ?').run(ctx.th); auditar(db, ctx, 'LOGOUT'); } return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion('', 0) }); }
  if (ruta === '/api/yo' && m === 'GET') { if (!ctx) throw err(401, 'Sesión caducada. Vuelve a entrar.'); return json(res, 200, yo(ctx)); }
  if (ruta === '/api/yo/clave' && m === 'POST') {
    if (!ctx) throw err(401, 'Sesión caducada. Vuelve a entrar.');
    const u = db.prepare('select * from usuarios where id = ?').get(ctx.uid);
    if (!verificarClave(String(b.actual || ''), u.salt, u.hash)) throw err(400, 'La contraseña actual no es correcta');
    const e = validarClave(b.nueva, u.usuario); if (e) throw err(400, e);
    if (b.nueva === b.actual) throw err(400, 'La nueva contraseña debe ser distinta de la actual');
    const { salt, hash } = hashClave(b.nueva);
    db.prepare('update usuarios set salt = ?, hash = ?, cambiar_clave = 0 where id = ?').run(salt, hash, u.id);
    db.prepare('delete from sesiones where usuario_id = ? and token_hash != ?').run(u.id, ctx.th);
    auditar(db, ctx, 'CLAVE_CAMBIO'); return json(res, 200, { ok: true });
  }
  if (ruta === '/api/cortes' && m === 'GET') { exigir(ctx, 'cortes.ver'); return json(res, 200, db.prepare('select * from cortes where eliminado = 0 order by creado desc').all().map(filaACorte)); }
  if (ruta === '/api/cortes' && m === 'POST') { exigir(ctx); return json(res, 200, { ok: true, ids: guardarCortes(ctx, b) }); }
  if ((mm = ruta.match(/^\/api\/cortes\/([0-9a-f-]{36})$/i)) && m === 'DELETE') {
    exigir(ctx, 'cortes.borrar');
    const r = db.prepare('select * from cortes where id = ? and eliminado = 0').get(mm[1]); if (!r) throw err(404, 'Corte no encontrado');
    db.prepare('update cortes set eliminado = 1, modificado = ?, modificado_por = ? where id = ?').run(ahoraISO(), ctx.usuario, r.id);
    const d = JSON.parse(r.datos); auditar(db, ctx, 'CORTE_BORRADO', { corte_id: r.id, calle: d.calle, detalle: 'Eliminado (recuperable por un mando)', datos: resumenCorte(d) });
    return json(res, 200, { ok: true });
  }
  if ((mm = ruta.match(/^\/api\/cortes\/([0-9a-f-]{36})\/restaurar$/i)) && m === 'POST') {
    exigir(ctx, 'auditoria.restaurar');
    const r = db.prepare('select * from cortes where id = ? and eliminado = 1').get(mm[1]); if (!r) throw err(404, 'No hay ningún corte eliminado con ese identificador');
    db.prepare('update cortes set eliminado = 0, publicado = 0, modificado = ?, modificado_por = ? where id = ?').run(ahoraISO(), ctx.usuario, r.id);
    auditar(db, ctx, 'CORTE_RESTAURADO', { corte_id: r.id, calle: JSON.parse(r.datos).calle, detalle: 'Restaurado sin publicar' }); return json(res, 200, { ok: true });
  }
  if (ruta === '/api/auditoria' && m === 'GET') {
    exigir(ctx, 'auditoria.ver');
    const lim = Math.min(+q.get('limite') || 300, 2000), acc = q.get('accion'), txt = (q.get('q') || '').toLowerCase();
    let filas = db.prepare('select id,fecha,usuario,rol,accion,corte_id,calle,detalle,ip from auditoria order by id desc limit 5000').all();
    if (acc) filas = filas.filter(f => f.accion.startsWith(acc));
    if (txt) filas = filas.filter(f => `${f.usuario} ${f.calle} ${f.detalle}`.toLowerCase().includes(txt));
    const borrados = new Set(db.prepare('select id from cortes where eliminado = 1').all().map(x => x.id));
    return json(res, 200, filas.slice(0, lim).map(f => ({ ...f, restaurable: f.accion === 'CORTE_BORRADO' && borrados.has(f.corte_id) })));
  }
  if (ruta === '/api/auditoria/verificar' && m === 'GET') { exigir(ctx, 'auditoria.integridad'); return json(res, 200, verificarAuditoria(db)); }
  if ((mm = ruta.match(/^\/api\/usuarios(?:\/(\d+))?$/))) { exigir(ctx); return json(res, 200, usuariosApi(ctx, req, mm, b)); }
  if (ruta === '/api/sistema' && m === 'GET') {
    exigir(ctx, 'sistema');
    return json(res, 200, { version: VERSION, node: process.version, arranque: new Date(Date.now() - process.uptime() * 1000).toISOString(), usuarios: db.prepare('select count(*) n from usuarios').get().n,
      auditoria: db.prepare('select count(*) n from auditoria').get().n, bd_bytes: fs.statSync(CFG.db).size, zona_horaria: process.env.TZ, https: CFG.secure, integridad: verificarAuditoria(db) });
  }
  if (ruta === '/api/copia' && m === 'GET') {
    exigir(ctx, 'copia'); auditar(db, ctx, 'COPIA_DESCARGADA');
    return json(res, 200, { generado: ahoraISO(), cortes: db.prepare('select * from cortes').all().map(r => ({ ...filaACorte(r), eliminado: !!r.eliminado })), auditoria: db.prepare('select * from auditoria order by id').all() },
      { 'Content-Disposition': `attachment; filename="copia-cortes-${ahoraISO().slice(0, 10)}.json"` });
  }
  throw err(404, 'No existe');
}

/* ───────── Ficheros estáticos (lista cerrada) ───────── */
const PERMITIDO = /^\/(index\.html|style\.css|config\.js|manifest\.webmanifest|sw\.js|[\w-]+\.png|js\/[\w.-]+\.js|vendor\/leaflet\/[\w./-]+)$/;
const TIPOS_MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', webmanifest: 'application/manifest+json', json: 'application/json' };
function estatico(req, res, ruta) {
  if (ruta === '/') ruta = '/index.html';
  if (!PERMITIDO.test(ruta) || ruta.includes('..')) return json(res, 404, { error: 'No existe' });
  const f = path.join(CFG.web, ruta);
  if (!f.startsWith(CFG.web + path.sep)) return json(res, 404, { error: 'No existe' });
  fs.readFile(f, (e, d) => {
    if (e) return json(res, 404, { error: 'No existe' });
    res.writeHead(200, cabecerasSeg({ 'Content-Type': TIPOS_MIME[ruta.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }));
    res.end(req.method === 'HEAD' ? undefined : d);
  });
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'); let ruta = decodeURIComponent(u.pathname);
    if (CFG.basePath && ruta.startsWith(CFG.basePath)) ruta = ruta.slice(CFG.basePath.length) || '/';
    if (ruta.startsWith('/api/')) await api(req, res, ruta, u.searchParams); else if (req.method === 'GET' || req.method === 'HEAD') estatico(req, res, ruta); else json(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    if (e.status) json(res, e.status, { error: e.message }); else { console.error(e); json(res, 500, { error: 'Error interno del servidor' }); }
  }
}).listen(CFG.port, CFG.host, () => console.log(`Cortes de calle ${VERSION} escuchando en http://${CFG.host}:${CFG.port}  ·  BD: ${CFG.db}`));
