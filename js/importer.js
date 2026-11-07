/* Importación desde Excel (.xlsx) y CSV: lectura, correspondencia de columnas y localización en el mapa */
import { toInput, normKey, TIPOS } from './util.js?v=20261107b';
import { locateTramo } from './net.js?v=20261107b';

/* ───────── Lectura de archivos ───────── */
export async function readTable(file) {
  const buf = await file.arrayBuffer(), name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(buf);
  if (name.endsWith('.xls')) throw new Error('Formato .xls antiguo: en Excel usa «Guardar como» .xlsx o .csv');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  return toTable(parseCsv(text.replace(/^﻿/, '')));
}
function parseCsv(t) {
  const first = t.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function toTable(rows) {
  rows = rows.filter(r => r.some(c => String(c).trim() !== ''));
  if (rows.length < 2) throw new Error('El archivo no tiene filas de datos');
  const headers = rows[0].map((h, i) => String(h).trim() || `Columna ${i + 1}`);
  return { headers, rows: rows.slice(1).map(r => headers.map((_, i) => String(r[i] ?? '').trim())) };
}

async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('No es un archivo .xlsx válido');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files.set(new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen)), { method, csize, off });
    p += 46 + nlen + elen + clen;
  }
  return async name => {
    const f = files.get(name); if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(data);
    if (f.method !== 8) throw new Error('Compresión de .xlsx no soportada');
    const out = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(out).arrayBuffer());
  };
}
async function readXlsx(buf) {
  const read = await unzip(buf), xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [], ss = await read('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  let path = 'xl/worksheets/sheet1.xml';
  const wb = await read('xl/workbook.xml'), rels = await read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const sh = xml(wb).getElementsByTagName('sheet')[0], rid = sh && (sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = [...xml(rels).getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (rel) { const t = rel.getAttribute('Target'); path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.?\//, ''); }
  }
  const sx = await read(path); if (!sx) throw new Error('No se encontró la hoja de datos en el .xlsx');
  const rows = [];
  for (const r of xml(sx).getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const m = /^([A-Z]+)/.exec(c.getAttribute('r') || ''); if (!m) continue;
      let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64; col--;
      const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      let val = '';
      if (t === 's') val = shared[+v.textContent] ?? '';
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (v) val = v.textContent;
      row[col] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return toTable(rows);
}

/* ───────── Correspondencia de columnas ───────── */
export const FIELDS = [
  { k: 'calle', label: 'Calle', req: true, syn: ['calle', 'via', 'lugar', 'ubicacion', 'direccion', 'nombre via', 'nombre de la via'] },
  { k: 'tramo', label: 'Tramo («entre A y B»)', syn: ['tramo', 'tramo afectado', 'entre', 'tramos'] },
  { k: 'desde', label: 'Desde (calle de inicio)', syn: ['desde', 'tramo desde', 'cruce inicio', 'inicio tramo'] },
  { k: 'hasta', label: 'Hasta (calle final)', syn: ['hasta', 'tramo hasta', 'cruce fin', 'fin tramo'] },
  { k: 'tipo', label: 'Tipo de afección', syn: ['tipo', 'afeccion', 'tipo de corte', 'tipo corte'] },
  { k: 'lado', label: 'Lado (pares / impares)', syn: ['lado', 'acera', 'paridad', 'numeros', 'pares impares'] },
  { k: 'motivo', label: 'Motivo', syn: ['motivo', 'causa', 'razon', 'evento', 'descripcion'] },
  { k: 'organismo', label: 'Solicita / origen', syn: ['solicita', 'solicitante', 'organismo', 'origen', 'peticionario', 'promotor', 'empresa'] },
  { k: 'autoriza', label: 'Autoriza', syn: ['autoriza', 'autorizado por', 'autoridad', 'autorizacion'] },
  { k: 'inicio', label: 'Fecha (y hora) de inicio', req: true, syn: ['fecha inicio', 'fecha de inicio', 'inicio', 'fecha desde', 'fecha', 'desde fecha', 'comienzo'] },
  { k: 'hinicio', label: 'Hora de inicio (si va aparte)', syn: ['hora inicio', 'hora de inicio', 'hora desde', 'h inicio'] },
  { k: 'fin', label: 'Fecha (y hora) de fin', syn: ['fecha fin', 'fecha de fin', 'fin', 'fecha hasta', 'hasta fecha', 'finalizacion'] },
  { k: 'hfin', label: 'Hora de fin (si va aparte)', syn: ['hora fin', 'hora de fin', 'hora hasta', 'h fin'] },
  { k: 'desvio', label: 'Desvío', syn: ['desvio', 'desvios', 'itinerario alternativo'] },
  { k: 'obs', label: 'Observaciones (internas)', syn: ['observaciones', 'notas', 'comentarios', 'observacion'] },
  { k: 'referencia', label: 'Referencia / expediente', syn: ['referencia', 'expediente', 'decreto', 'registro', 'n expediente', 'num expediente'] },
];
export function autoMap(headers) {
  const norm = headers.map(normKey), map = {}, used = new Set();
  for (const pass of [0, 1]) for (const f of FIELDS) {
    if (map[f.k] !== undefined) continue;
    const i = norm.findIndex((h, j) => !used.has(j) && (pass === 0 ? f.syn.includes(h) : f.syn.some(s => s.length > 3 && h.includes(s))));
    if (i >= 0) { map[f.k] = i; used.add(i); }
  }
  return map;
}
export const TEMPLATE = 'calle;desde;hasta;tipo;motivo;solicita;autoriza;fecha_inicio;hora_inicio;fecha_fin;hora_fin;desvio;observaciones;referencia\r\n' +
  'Calle Ejemplo;Calle Primera;Calle Segunda;Corte total;Obra;Empresa de obras;Ayuntamiento;15/11/2026;08:00;20/11/2026;20:00;Circular por Calle Tercera;;Decreto 123/2026\r\n';

/* ───────── Fechas ───────── */
export function parseDT(v, t) {
  v = String(v ?? '').trim(); let d = null;
  if (!v) return null;
  if (/^\d{4,6}(\.\d+)?$/.test(v)) {                         // número de serie de Excel
    const u = new Date(Math.round((parseFloat(v) - 25569) * 1440) * 6e4);
    d = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  } else {
    let m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T,]+(\d{1,2})[:.h](\d{2}))?/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; d = new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); }
    else if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/))) d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }
  if (!d || isNaN(d)) return null;
  t = String(t ?? '').trim();
  if (t) {
    let mins = null;
    if (/^\d*\.\d+$|^0$/.test(t) && parseFloat(t) < 1) mins = Math.round(parseFloat(t) * 1440);
    else { const m = t.match(/(\d{1,2})[:.h](\d{2})/); if (m) mins = +m[1] * 60 + +m[2]; }
    if (mins != null) d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, mins);
  }
  return toInput(d);
}

/* ───────── Construcción de filas ───────── */
function tipoDe(s) {
  const k = normKey(s);
  if (!k) return 'total';
  if (/parcial|carril|sentido|unico|restric/.test(k)) return 'parcial';
  if (/estac|aparc/.test(k)) return 'estac';
  return TIPOS[k] ? k : 'total';
}
function splitTramo(s) {
  const m = String(s || '').match(/(?:entre|desde|de)\s+(.+?)\s+(?:y|hasta|a)\s+(.+)$/i);
  return m ? [m[1].trim(), m[2].trim()] : null;
}
export function buildItems(table, map) {
  return table.rows.map((row, n) => {
    const g = k => (map[k] === undefined ? '' : String(row[map[k]] ?? '').trim());
    let desde = g('desde'), hasta = g('hasta');
    if ((!desde || !hasta) && g('tramo')) { const s = splitTramo(g('tramo')); if (s) [desde, hasta] = s; }
    const warns = [];
    let inicio = parseDT(g('inicio'), g('hinicio'));
    if (!inicio) { inicio = toInput(new Date()); warns.push('sin fecha de inicio válida: se usa la actual'); }
    const fin = parseDT(g('fin'), g('hfin')) || '';
    if (fin && fin < inicio) warns.push('la fecha de fin es anterior al inicio');
    const corte = {
      calle: g('calle'), tramo: g('tramo') || (desde && hasta ? `entre ${desde} y ${hasta}` : ''), tipo: tipoDe(g('tipo')),
      lado: /impar/i.test(g('lado')) ? 'impares' : /par/i.test(g('lado')) ? 'pares' : '',
      motivo: g('motivo') || 'Otro', organismo: g('organismo'), autoriza: g('autoriza'), autoriza_detalle: '', referencia: g('referencia'),
      inicio, fin, desvio: g('desvio'), obs: g('obs'), publicado: false, origen: 'importado',
    };
    let loc = { status: 'no', segs: [], msg: 'Falta la calle' };
    if (corte.calle) loc = locateTramo(corte.calle, desde, hasta);
    return { n: n + 2, corte, segs: loc.segs, status: loc.status, msg: [loc.msg, ...warns].filter(Boolean).join(' · '), sel: loc.status === 'ok' };
  });
}
