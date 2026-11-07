/* Utilidades comunes: textos, fechas, catálogos */
export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = n => String(n).padStart(2, '0');
export const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
export const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parse = s => (s ? new Date(s) : null);
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

/* ───────── Catálogos ───────── */
export const TIPOS = {
  total:   { label: 'Corte total',                 human: 'Calle cortada al tráfico',                       color: '#d92d20' },
  parcial: { label: 'Corte parcial / un carril',   human: 'Circulación restringida (puede quedar un carril)', color: '#f79009' },
  sentido: { label: 'Sentido único / restricción', human: 'Cambio de sentido o restricción de circulación',  color: '#1570ef' },
  estac:   { label: 'Prohibido estacionar',        human: 'Prohibido estacionar en este tramo',              color: '#7a5af8' },
};
export const MOTIVOS = ['Obra', 'Evento / procesión', 'Mercadillo / feria', 'Mantenimiento / servicio', 'Incidencia / emergencia', 'Otro'];
export const SOLICITA = ['Policía Local', 'Ayuntamiento', 'Empresa de obras', 'Particular', 'Otro organismo'];
export const AUTORIZA = ['Ayuntamiento', 'Policía Local', 'Junta de Extremadura', 'Diputación de Badajoz', 'Otro organismo'];
export const GREY = '#98a2b3';
export const ESTADO_LBL = { act: 'Activo', prog: 'Programado', fin: 'Finalizado' };

/* ───────── Fechas y duración ───────── */
const DF = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
export const hora = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function diaTxt(d, ref) {
  const diff = Math.round((startOfDay(d) - startOfDay(ref)) / 864e5);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return DF.format(d).replace('.', '') + (d.getFullYear() !== ref.getFullYear() ? ' ' + d.getFullYear() : '');
}
export const fmtDT = (d, ref) => `${diaTxt(d, ref)} a las ${hora(d)}`;
export function span(ms) {
  const m = Math.max(0, Math.round(ms / 6e4));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return `${h} h${mm ? ' ' + mm + ' min' : ''}`;
  return `${Math.round(ms / 864e5)} días`;
}
export function estado(c, t) {
  const i = parse(c.inicio), f = parse(c.fin);
  if (i && t < i) return 'prog';
  if (f && t > f) return 'fin';
  return 'act';
}
export const esLarga = c => { const i = parse(c.inicio), f = parse(c.fin); return !f || (f - i) >= 7 * 864e5; };
export function durText(c, ref) {
  const i = parse(c.inicio), f = parse(c.fin), e = estado(c, ref);
  if (!f) return `Desde ${fmtDT(i, ref)} · sin fecha de fin prevista`;
  const total = span(f - i);
  if (e === 'prog') return `Empieza ${fmtDT(i, ref)} y termina ${fmtDT(f, ref)} · duración ${total}`;
  if (e === 'act') return `Hasta ${fmtDT(f, ref)} · quedan ${span(f - ref)} (duración total ${total})`;
  return `Finalizó ${fmtDT(f, ref)} · duración ${total}`;
}
export function shortText(c, ref) {
  const i = parse(c.inicio), f = parse(c.fin), e = estado(c, ref);
  if (e === 'prog') return `Desde ${fmtDT(i, ref)}${f ? ' hasta ' + fmtDT(f, ref) : ''}`;
  if (e === 'fin') return `Finalizó ${fmtDT(f, ref)}`;
  return f ? `Hasta ${fmtDT(f, ref)}` : 'Sin fecha de fin prevista';
}

/* ───────── Geometría sin dependencias ───────── */
export function distM(a, b) {
  const R = 6371008.8, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const lengthM = path => { let s = 0; for (let k = 1; k < path.length; k++) s += distM(path[k - 1], path[k]); return s; };
export const totalLen = segs => (segs || []).reduce((a, p) => a + lengthM(p), 0);
export const fmtLen = m => (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m');

/* Normaliza nombres de vía para compararlos ("C/ Santa Marta" ≈ "Calle de Santa Marta") */
const STOP = new Set(['calle', 'c', 'cl', 'avenida', 'avda', 'av', 'plaza', 'pza', 'pl', 'paseo', 'pso', 'camino', 'carretera', 'ctra', 'travesia', 'trav', 'ronda', 'callejon', 'urbanizacion', 'urb', 'glorieta', 'de', 'del', 'la', 'las', 'los', 'el']);
export function normName(s) {
  s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/\bc\/\s*/g, 'calle ').replace(/\b(avda|avd)\.?/g, 'avenida').replace(/[.,;()"'º°]/g, ' ');
  return s.split(/\s+/).filter(t => t && !STOP.has(t)).join(' ');
}
export function normKey(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

let toastT = 0;
export function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3600); }
