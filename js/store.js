/* Capa de datos. Dos modos:
 *  - REMOTO: Supabase (Postgres + autenticación). Los agentes inician sesión y los ciudadanos leen una vista pública.
 *  - LOCAL: sin servidor; los datos quedan en este dispositivo (modo de pruebas).
 * Se elige según config.js. */
import { lsGet, lsSet, toInput, isUuid, uid } from './util.js';

const cfg = window.CORTES_CONFIG || {};
export const remote = !!(cfg.supabaseUrl && cfg.supabaseKey);
const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
const KEY = cfg.supabaseKey || '';
const SES = 'cortes.sesion', LOC = 'cortes.v1', LOG = 'cortes.log.v1', PUBC = 'cortes.publico.cache';

let ses = null;
try { ses = JSON.parse(lsGet(SES, 'null')); } catch { ses = null; }
export const session = () => (remote ? ses : { email: 'Modo de pruebas' });
export const userName = () => (remote ? (ses && ses.email) || '' : 'Modo de pruebas');
export const loggedIn = () => (remote ? !!ses : true);

/* ───────── HTTP ───────── */
async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { apikey: KEY, Authorization: 'Bearer ' + (token || KEY), 'Content-Type': 'application/json', ...headers },
  });
  if (!r.ok) {
    let m = ''; try { const j = await r.json(); m = j.message || j.error_description || j.msg || j.error || ''; } catch { /* sin cuerpo */ }
    const e = new Error(m || 'Error ' + r.status); e.status = r.status; throw e;
  }
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
function setSes(j) {
  ses = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), email: (j.user && j.user.email) || (ses && ses.email) || '' };
  lsSet(SES, JSON.stringify(ses));
}
async function refresh() {
  try { setSes(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: ses.refresh_token } })); }
  catch { logout(); throw new Error('La sesión ha caducado. Vuelve a entrar.'); }
}
async function authed(path, opt = {}) {
  if (!ses) throw new Error('Sesión no iniciada');
  if (ses.expires_at - Date.now() / 1000 < 60) await refresh();
  try { return await raw(path, { ...opt, token: ses.access_token }); }
  catch (e) { if (e.status === 401) { await refresh(); return raw(path, { ...opt, token: ses.access_token }); } throw e; }
}
export async function init() { if (remote && ses && ses.expires_at - Date.now() / 1000 < 60) { try { await refresh(); } catch { /* se pedirá login */ } } }
export async function login(email, password) {
  try { setSes(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } })); }
  catch (e) { throw new Error(/invalid login|credentials/i.test(e.message) ? 'Usuario o contraseña incorrectos' : e.message); }
}
export function logout() { ses = null; try { localStorage.removeItem(SES); } catch { /* nada */ } }

/* ───────── Conversión fila ⇄ corte ───────── */
const iso = s => (s ? new Date(s).toISOString() : null);
const loc = s => (s ? toInput(new Date(s)) : '');
const toRow = c => ({
  id: c.id, calle: c.calle, tramo: c.tramo || '', tipo: c.tipo || 'total', motivo: c.motivo || '', organismo: c.organismo || '',
  autoriza: c.autoriza || '', autoriza_detalle: c.autoriza_detalle || '', referencia: c.referencia || '',
  inicio: iso(c.inicio), fin: iso(c.fin), desvio: c.desvio || '', obs: c.obs || '', segs: c.segs,
  publicado: c.publicado !== false, origen: c.origen || 'manual',
});
const fromRow = r => ({
  id: r.id, calle: r.calle, tramo: r.tramo || '', tipo: r.tipo || 'total', motivo: r.motivo || '', organismo: r.organismo || '',
  autoriza: r.autoriza || '', autoriza_detalle: r.autoriza_detalle || '', referencia: r.referencia || '',
  inicio: loc(r.inicio), fin: loc(r.fin), desvio: r.desvio || '', obs: r.obs || '', segs: r.segs || [],
  publicado: r.publicado !== false, origen: r.origen || 'manual',
  creado: r.creado, modificado: r.modificado, creado_por: r.creado_por, modificado_por: r.modificado_por,
});
const INTERNAL = ['obs', 'referencia', 'creado_por', 'modificado_por'];
const publicView = c => { const o = { ...c }; INTERNAL.forEach(k => delete o[k]); return o; };

/* ───────── Modo local ───────── */
function localAll() {
  try { const a = JSON.parse(lsGet(LOC, '[]')); return Array.isArray(a) ? a.map(c => ({ autoriza: '', autoriza_detalle: '', referencia: '', publicado: true, origen: 'manual', ...c })) : []; } catch { return []; }
}
function localSave(list) { if (!lsSet(LOC, JSON.stringify(list))) throw new Error('No se pudo guardar en este dispositivo (almacenamiento lleno o bloqueado)'); }
function localLog(accion, c) {
  let l = []; try { l = JSON.parse(lsGet(LOG, '[]')); } catch { l = []; }
  l.unshift({ fecha: new Date().toISOString(), usuario: 'Modo de pruebas', accion, corte_id: c.id, calle: c.calle });
  lsSet(LOG, JSON.stringify(l.slice(0, 300)));
}

/* ───────── API pública ───────── */
export async function loadPublic() {
  if (!remote) return { list: localAll().filter(c => c.publicado !== false).map(publicView), stale: null };
  try {
    const rows = await raw('/rest/v1/cortes_publicos?select=*');
    const list = rows.map(fromRow);
    lsSet(PUBC, JSON.stringify({ t: Date.now(), list }));
    return { list, stale: null };
  } catch (e) {
    try { const c = JSON.parse(lsGet(PUBC, 'null')); if (c) return { list: c.list, stale: c.t }; } catch { /* sin caché */ }
    throw e;
  }
}
export async function loadAll() {
  if (!remote) return localAll();
  return (await authed('/rest/v1/cortes?select=*&order=inicio.desc')).map(fromRow);
}
export async function save(c) { return saveMany([c]); }
export async function saveMany(list) {
  list = list.map(c => (remote && !isUuid(c.id) ? { ...c, id: uid() } : c));
  if (remote) return authed('/rest/v1/cortes', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: list.map(toRow) });
  const all = localAll();
  for (const c of list) {
    const k = all.findIndex(x => x.id === c.id);
    const now = new Date().toISOString();
    if (k >= 0) { all[k] = { ...all[k], ...c, modificado: now }; localLog('UPDATE', c); }
    else { all.push({ ...c, creado: c.creado || now, modificado: now }); localLog('INSERT', c); }
  }
  localSave(all);
}
export async function remove(id) {
  if (remote) return authed(`/rest/v1/cortes?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  const all = localAll(), c = all.find(x => x.id === id);
  if (c) localLog('DELETE', c);
  localSave(all.filter(x => x.id !== id));
}
export async function removeAll() {
  if (remote) throw new Error('El borrado total no está permitido con servidor');
  localAll().forEach(c => localLog('DELETE', c)); localSave([]);
}
export async function loadLog() {
  if (!remote) { try { return JSON.parse(lsGet(LOG, '[]')); } catch { return []; } }
  const rows = await authed('/rest/v1/historial?select=*&order=fecha.desc&limit=200');
  return rows.map(r => ({ fecha: r.fecha, usuario: r.usuario, accion: r.accion, corte_id: r.corte_id, calle: (r.datos && r.datos.calle) || '' }));
}
