/* Capa de datos. Dos modos, detectados solos al arrancar:
 *  - SERVIDOR: la aplicación se sirve desde servidor/server.mjs (API en «api/…»). Acceso con usuario y perfiles, datos compartidos.
 *  - LOCAL (demostración): sin servidor (p. ej. GitHub Pages). Datos solo en este dispositivo, sin usuarios. */
import { lsGet, lsSet, isUuid, uid } from './util.js?v=20261108f';

let modo = 'local', yo = null;
const LOC = 'cortes.v1', LOG = 'cortes.log.v1', PUBC = 'cortes.publico.cache';
export const isRemote = () => modo === 'api';
const PERMISOS_LOCAL = ['cortes.ver', 'cortes.crear', 'cortes.editar', 'cortes.publicar', 'cortes.borrar', 'cortes.importar', 'auditoria.ver', 'copia'];
export const user = () => (isRemote() ? yo : { usuario: 'demo', nombre: 'Modo de pruebas', rol: 'mando', rol_nombre: 'Demostración', permisos: PERMISOS_LOCAL });
export const can = p => !!(user() && user().permisos.includes(p));
export const loggedIn = () => (isRemote() ? !!yo : true);
export const userName = () => { const u = user(); return u ? (isRemote() && u.nombre !== u.rol_nombre ? `${u.nombre} · ${u.rol_nombre}` : u.nombre) : ''; };

/* ───────── HTTP ───────── */
async function api(ruta, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch('api/' + ruta, { method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' || method === 'HEAD' ? {} : { 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body === undefined ? {} : body) });
  } catch { throw Object.assign(new Error('No hay conexión con el servidor'), { status: 0 }); }
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* no JSON */ }
  if (!r.ok) {
    const e = Object.assign(new Error((j && j.error) || 'Error ' + r.status), { status: r.status });
    if (r.status === 401 && yo) yo = null;
    throw e;
  }
  return j;
}

export async function init() {
  try { const r = await fetch('api/estado', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.app === 'cortes') modo = 'api'; } } catch { modo = 'local'; }
  if (modo === 'api') { try { yo = await api('yo'); } catch { yo = null; } }
}
export async function login(usuario, clave) { yo = await api('login', { method: 'POST', body: { usuario, clave } }); return yo; }
export async function logout() { try { await api('logout', { method: 'POST' }); } catch { /* ya cerrada */ } yo = null; }
export async function changePassword(actual, nueva) { await api('yo/clave', { method: 'POST', body: { actual, nueva } }); yo = await api('yo'); }

/* ───────── Modo local ───────── */
function localAll() {
  try { const a = JSON.parse(lsGet(LOC, '[]')); return Array.isArray(a) ? a.map(c => ({ autoriza: '', autoriza_detalle: '', referencia: '', publicado: true, origen: 'manual', ...c })) : []; } catch { return []; }
}
function localSave(list) { if (!lsSet(LOC, JSON.stringify(list))) throw new Error('No se pudo guardar en este dispositivo (almacenamiento lleno o bloqueado)'); }
function localLog(accion, c) {
  let l = []; try { l = JSON.parse(lsGet(LOG, '[]')); } catch { l = []; }
  l.unshift({ id: Date.now() + Math.random(), fecha: new Date().toISOString(), usuario: 'demo', rol: 'mando', accion, corte_id: c.id, calle: c.calle, detalle: '', restaurable: false });
  lsSet(LOG, JSON.stringify(l.slice(0, 300)));
}
const INTERNOS = ['obs', 'referencia', 'firma', 'creado_por', 'modificado_por'];

/* ───────── Cortes ───────── */
export async function loadPublic() {
  if (!isRemote()) return { list: localAll().filter(c => c.publicado !== false).map(c => { const o = { ...c }; INTERNOS.forEach(k => delete o[k]); return o; }), stale: null };
  try {
    const list = await api('publico');
    lsSet(PUBC, JSON.stringify({ t: Date.now(), list })); return { list, stale: null };
  } catch (e) {
    try { const c = JSON.parse(lsGet(PUBC, 'null')); if (c) return { list: c.list, stale: c.t }; } catch { /* sin caché */ }
    throw e;
  }
}
export async function loadAll() { return isRemote() ? api('cortes') : localAll(); }
export const save = (c, lote) => saveMany([c], lote);
export async function saveMany(list, lote) {
  if (isRemote()) {
    list = list.map(c => (isUuid(c.id) ? c : { ...c, id: uid() }));
    return api('cortes', { method: 'POST', body: { cortes: list.map(c => ({ ...c, _base: c.modificado })), lote } });
  }
  const all = localAll(), now = new Date().toISOString();
  for (const c of list) {
    const k = all.findIndex(x => x.id === c.id);
    if (k >= 0) { all[k] = { ...all[k], ...c, modificado: now }; localLog('CORTE_EDICION', c); }
    else { all.push({ ...c, creado: c.creado || now, modificado: now }); localLog('CORTE_ALTA', c); }
  }
  if (lote && lote.tipo === 'importacion') localLog('IMPORTACION', { id: '', calle: lote.archivo });
  localSave(all);
}
export async function remove(id) {
  if (isRemote()) return api('cortes/' + encodeURIComponent(id), { method: 'DELETE' });
  const all = localAll(), c = all.find(x => x.id === id); if (c) localLog('CORTE_BORRADO', c); localSave(all.filter(x => x.id !== id));
}
export async function removeAll() {
  if (isRemote()) throw new Error('El borrado total no está permitido con servidor');
  localAll().forEach(c => localLog('CORTE_BORRADO', c)); localSave([]);
}
export const restore = id => api(`cortes/${encodeURIComponent(id)}/restaurar`, { method: 'POST' });

/* ───────── Auditoría, usuarios, sistema ───────── */
export async function loadAudit({ accion = '', q = '' } = {}) {
  if (!isRemote()) { try { return JSON.parse(lsGet(LOG, '[]')).filter(l => (!accion || l.accion.startsWith(accion)) && (!q || `${l.calle}`.toLowerCase().includes(q.toLowerCase()))); } catch { return []; } }
  return api(`auditoria?limite=500&accion=${encodeURIComponent(accion)}&q=${encodeURIComponent(q)}`);
}
export const verifyAudit = () => api('auditoria/verificar');
export const listUsers = () => api('usuarios');
export const createUser = u => api('usuarios', { method: 'POST', body: u });
export const patchUser = (id, b) => api('usuarios/' + id, { method: 'PATCH', body: b });
export const system = () => api('sistema');
export const backup = () => api('copia');
