/* Cortes de calle · Don Benito — MVP (trazado manual)
 * Datos guardados en el dispositivo (localStorage). Exportar/Importar GeoJSON para compartir.
 */
(() => {
'use strict';

/* ───────── Utilidades ───────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = s => (s ? new Date(s) : null);
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : v; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

const CFG = {
  center: [38.9565, -5.8612], zoom: 15,
  bbox: [38.936, -5.884, 38.976, -5.838],      // S, O, N, E (casco urbano Don Benito–Villanueva)
  snapMax: 70,                                  // metros máximos para "pegarse" a una calle
};
const STORE_KEY = 'cortes.v1', NET_KEY = 'cortes.callejero.v1', BASE_KEY = 'cortes.base';
const TIPOS = {
  total:    { label: 'Corte total',                 color: '#d92d20' },
  parcial:  { label: 'Corte parcial / un carril',   color: '#f79009' },
  sentido:  { label: 'Sentido único / restricción', color: '#1570ef' },
  estac:    { label: 'Prohibido estacionar',        color: '#7a5af8' },
};
const MOTIVOS = ['Obra', 'Evento / procesión', 'Mercadillo / feria', 'Mantenimiento / servicio', 'Incidencia / emergencia', 'Otro'];
const ORGS = ['Policía Local', 'Ayuntamiento', 'Empresa de obras', 'Otro organismo'];
const GREY = '#98a2b3';

/* ───────── Estado ───────── */
const state = {
  cortes: [],
  view: new Date(), live: true, scope: 'instante',
  sel: null,            // id seleccionado
  screen: 'list',       // list | detail | draw | form
};
let draft = null;       // trazado/edición en curso

function loadCortes() {
  try { const a = JSON.parse(lsGet(STORE_KEY, '[]')); return Array.isArray(a) ? a : []; } catch { return []; }
}
function saveCortes() {
  if (!lsSet(STORE_KEY, JSON.stringify(state.cortes))) toast('⚠ No se pudo guardar en este dispositivo (almacenamiento lleno o bloqueado)');
}

/* ───────── Fechas y duración ───────── */
const DF = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const hora = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function diaTxt(d, ref) {
  const diff = Math.round((startOfDay(d) - startOfDay(ref)) / 864e5);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return DF.format(d).replace('.', '') + (d.getFullYear() !== ref.getFullYear() ? ' ' + d.getFullYear() : '');
}
const fmtDT = (d, ref) => `${diaTxt(d, ref)} a las ${hora(d)}`;
function span(ms) {
  const m = Math.max(0, Math.round(ms / 6e4));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return `${h} h${mm ? ' ' + mm + ' min' : ''}`;
  return `${Math.round(ms / 864e5)} días`;
}
function estado(c, t) {
  const i = parse(c.inicio), f = parse(c.fin);
  if (i && t < i) return 'prog';
  if (f && t > f) return 'fin';
  return 'act';
}
const ESTADO_LBL = { act: 'Activo', prog: 'Programado', fin: 'Finalizado' };
const esLarga = c => { const i = parse(c.inicio), f = parse(c.fin); return !f || (f - i) >= 7 * 864e5; };

function durText(c, ref) {
  const i = parse(c.inicio), f = parse(c.fin), e = estado(c, ref);
  if (!f) return `Desde ${fmtDT(i, ref)} · sin fecha de fin (indefinido)`;
  const total = span(f - i);
  if (e === 'prog') return `Empieza ${fmtDT(i, ref)} y termina ${fmtDT(f, ref)} · duración ${total}`;
  if (e === 'act') return `Hasta ${fmtDT(f, ref)} · quedan ${span(f - ref)} (duración total ${total})`;
  return `Finalizó ${fmtDT(f, ref)} · duración ${total}`;
}
function shortText(c, ref) {
  const i = parse(c.inicio), f = parse(c.fin), e = estado(c, ref);
  if (e === 'prog') return `Desde ${fmtDT(i, ref)}${f ? ' hasta ' + fmtDT(f, ref) : ''}`;
  if (e === 'fin') return `Finalizó ${fmtDT(f, ref)}`;
  return f ? `Hasta ${fmtDT(f, ref)}` : 'Sin fecha de fin';
}
function visible(c) {
  const t = state.view;
  if (state.scope === 'todos') return true;
  if (state.scope === 'instante') return estado(c, t) === 'act';
  const d0 = startOfDay(t), d1 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1);
  const i = parse(c.inicio), f = parse(c.fin);
  return (!i || i < d1) && (!f || f >= d0);
}

/* ───────── Geometría ───────── */
const lengthM = path => { let s = 0; for (let k = 1; k < path.length; k++) s += L.latLng(path[k - 1]).distanceTo(L.latLng(path[k])); return s; };
const totalLen = segs => segs.reduce((a, p) => a + lengthM(p), 0);
const fmtLen = m => (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m');

/* ───────── Mapa ───────── */
const map = L.map('map', { zoomControl: false }).setView(CFG.center, CFG.zoom);
L.control.zoom({ position: 'topright' }).addTo(map);
const bases = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
  sat: L.tileLayer('https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&format=image/jpeg&tilematrix={z}&tilerow={y}&tilecol={x}', { maxZoom: 19, attribution: 'PNOA © <a href="https://www.ign.es">IGN</a>' }),
};
let baseKey = lsGet(BASE_KEY, 'osm'); if (!bases[baseKey]) baseKey = 'osm';
bases[baseKey].addTo(map);
function toggleBase() { map.removeLayer(bases[baseKey]); baseKey = baseKey === 'osm' ? 'sat' : 'osm'; bases[baseKey].addTo(map); bases[baseKey].bringToBack(); lsSet(BASE_KEY, baseKey); }

new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());   // el panel cambia de alto
const cortesLayer = L.featureGroup().addTo(map);
const draftLayer = L.featureGroup().addTo(map);
let netLayer = null;
const snapDot = L.circleMarker([0, 0], { radius: 7, color: '#1570ef', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false });

function colorOf(c, e) { return e === 'fin' ? GREY : (TIPOS[c.tipo] || TIPOS.total).color; }
function renderMap() {
  cortesLayer.clearLayers();
  for (const c of state.cortes) {
    if (!visible(c)) continue;
    if (draft && draft.id === c.id) continue;               // se está redibujando
    const e = estado(c, state.view), col = colorOf(c, e), sel = c.id === state.sel;
    if (sel) L.polyline(c.segs, { color: col, weight: 22, opacity: .28, interactive: false, lineCap: 'round' }).addTo(cortesLayer);
    const casing = L.polyline(c.segs, { color: '#fff', weight: 15, opacity: .9, lineCap: 'round', lineJoin: 'round' }).addTo(cortesLayer);
    L.polyline(c.segs, { color: col, weight: 8, opacity: 1, dashArray: e === 'prog' ? '2 12' : null, lineCap: e === 'prog' ? 'round' : 'round', lineJoin: 'round', interactive: false }).addTo(cortesLayer);
    casing.bindTooltip(`<b>${esc(c.calle)}</b><br>${esc(shortText(c, state.view))}`, { sticky: true });
    casing.on('click', ev => { if (draft) return; L.DomEvent.stopPropagation(ev); select(c.id, true); });
  }
}
function fitCorte(c) {
  const b = L.latLngBounds(c.segs.flat());
  map.fitBounds(b, { maxZoom: 18, padding: [30, 30] });
}

/* ───────── Callejero (Overpass) y grafo ───────── */
const net = { ready: false, adj: [], X: [], Y: [], lat: [], lon: [], ea: [], eb: [], el: [], en: [], names: [], nways: 0, lat0: CFG.center[0], lon0: CFG.center[1] };
const KY = 111320, KX = 111320 * Math.cos(CFG.center[0] * Math.PI / 180);
const xy = (lat, lon) => [(lon - CFG.center[1]) * KX, (lat - CFG.center[0]) * KY];

function setNetChip(txt, cls) { const el = $('#netchip'); el.textContent = txt; el.className = 'netchip ' + (cls || ''); }

function buildNet(ways) {
  Object.assign(net, { ready: false, adj: [], X: [], Y: [], lat: [], lon: [], ea: [], eb: [], el: [], en: [], names: [], nways: ways.length });
  const idx = new Map(), nameIdx = new Map();
  const nm = s => { s = s || ''; if (!nameIdx.has(s)) { nameIdx.set(s, net.names.length); net.names.push(s); } return nameIdx.get(s); };
  const node = (id, lat, lon) => {
    let k = idx.get(id);
    if (k === undefined) { k = net.lat.length; idx.set(id, k); net.lat.push(lat); net.lon.push(lon); const [x, y] = xy(lat, lon); net.X.push(x); net.Y.push(y); net.adj.push([]); }
    return k;
  };
  const lines = [];
  for (const w of ways) {
    const g = w.g, ids = w.n, ni = nm(w.name), line = [];
    for (let i = 0; i < ids.length; i++) {
      const lat = g[2 * i], lon = g[2 * i + 1];
      line.push([lat, lon]);
      if (i === 0) continue;
      const a = node(ids[i - 1], g[2 * i - 2], g[2 * i - 1]), b = node(ids[i], lat, lon);
      if (a === b) continue;
      const len = Math.hypot(net.X[a] - net.X[b], net.Y[a] - net.Y[b]);
      if (len < 0.05) continue;
      const e = net.ea.length;
      net.ea.push(a); net.eb.push(b); net.el.push(len); net.en.push(ni);
      net.adj[a].push([b, len, ni]); net.adj[b].push([a, len, ni]);
    }
    lines.push(line);
  }
  if (netLayer) { map.removeLayer(netLayer); netLayer = null; }
  netLayer = L.polyline(lines, { color: '#475467', weight: 2, opacity: .55, interactive: false });
  net.ready = net.ea.length > 0;
  if (net.ready) setNetChip(`Callejero: ${ways.length} vías`, 'ok');
  else setNetChip('Callejero vacío', 'bad');
  if (draft && draft.stage === 'draw' && net.ready) netLayer.addTo(map);
}

async function fetchOverpass() {
  const [s, w, n, e] = CFG.bbox;
  const q = `[out:json][timeout:60];way["highway"]["highway"!~"^(footway|steps|path|cycleway|bridleway|proposed|construction|corridor|elevator|platform|raceway|bus_guideway)$"]["service"!~"^(parking_aisle|driveway)$"](${s},${w},${n},${e});out geom;`;
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let lastErr;
  for (const url of endpoints) {
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 50000);
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const ways = [];
      for (const el of j.elements || []) {
        if (el.type !== 'way' || !el.geometry || !el.nodes || el.nodes.length !== el.geometry.length) continue;
        const g = []; for (const p of el.geometry) g.push(+p.lat.toFixed(6), +p.lon.toFixed(6));
        ways.push({ n: el.nodes, g, name: (el.tags && (el.tags.name || el.tags.ref)) || '' });
      }
      if (!ways.length) throw new Error('respuesta vacía');
      return ways;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function loadNet(force) {
  if (!force) {
    try {
      const c = JSON.parse(lsGet(NET_KEY, 'null'));
      if (c && c.ways && c.ways.length) { buildNet(c.ways); return; }
    } catch { /* cache corrupta: se vuelve a descargar */ }
  }
  setNetChip('Callejero: descargando…', '');
  try {
    const ways = await fetchOverpass();
    buildNet(ways);
    if (!lsSet(NET_KEY, JSON.stringify({ t: Date.now(), ways }))) console.warn('No se pudo cachear el callejero');
    if (force) toast('Callejero actualizado');
  } catch (err) {
    console.warn(err);
    setNetChip('Sin callejero · trazado libre', 'bad');
    toast('No se pudo descargar el callejero. Puedes usar el trazado libre.');
  }
}

/* Punto más cercano sobre una calle */
function snap(lat, lon, maxM) {
  if (!net.ready) return null;
  const [px, py] = xy(lat, lon);
  let best = Infinity, be = -1, bt = 0;
  for (let e = 0; e < net.ea.length; e++) {
    const a = net.ea[e], b = net.eb[e];
    const ax = net.X[a], ay = net.Y[a], dx = net.X[b] - ax, dy = net.Y[b] - ay;
    let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) { best = d; be = e; bt = t; }
  }
  if (be < 0 || best > maxM) return null;
  const a = net.ea[be], b = net.eb[be];
  return { e: be, t: bt, lat: net.lat[a] + bt * (net.lat[b] - net.lat[a]), lon: net.lon[a] + bt * (net.lon[b] - net.lon[a]) };
}

/* Montículo binario mínimo para Dijkstra */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, v) { const a = this.a; a.push([d, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

/* Ruta más corta por calles entre dos puntos "pegados" a la red */
function route(s1, s2) {
  const L1 = net.el[s1.e], L2 = net.el[s2.e];
  if (s1.e === s2.e) {
    return { path: [[s1.lat, s1.lon], [s2.lat, s2.lon]], names: [{ name: net.names[net.en[s1.e]], len: Math.abs(s1.t - s2.t) * L1 }] };
  }
  const n = net.adj.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pw = new Float64Array(n), pn = new Int32Array(n);
  const h = new Heap();
  const a1 = net.ea[s1.e], b1 = net.eb[s1.e], a2 = net.ea[s2.e], b2 = net.eb[s2.e];
  dist[a1] = s1.t * L1; h.push(dist[a1], a1);
  dist[b1] = (1 - s1.t) * L1; h.push(dist[b1], b1);
  const extra = new Map([[a2, s2.t * L2], [b2, (1 - s2.t) * L2]]);
  let best = Infinity, bestNode = -1;
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    if (d >= best) break;
    if (extra.has(u) && d + extra.get(u) < best) { best = d + extra.get(u); bestNode = u; }
    for (const [v, w, nm] of net.adj[u]) {
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; pw[v] = w; pn[v] = nm; h.push(nd, v); }
    }
  }
  if (bestNode < 0) return null;
  const nodes = [], names = [{ name: net.names[net.en[s2.e]], len: extra.get(bestNode) }];
  let u = bestNode;
  for (;;) {
    nodes.push(u);
    if (prev[u] === -1) { names.push({ name: net.names[net.en[s1.e]], len: dist[u] }); break; }
    names.push({ name: net.names[pn[u]], len: pw[u] });
    u = prev[u];
  }
  nodes.reverse();
  const path = [[s1.lat, s1.lon], ...nodes.map(k => [net.lat[k], net.lon[k]]), [s2.lat, s2.lon]];
  return { path, names };
}

/* ───────── Borrador de trazado ───────── */
function newDraft(base) {
  return { id: base ? base.id : null, base: base || null, mode: net.ready ? 'calles' : 'libre', stage: 'draw', segs: base ? base.segs.map(p => ({ path: p, names: [] })) : [], wps: [], legs: [] };
}
const curPath = () => draft.legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1)));
const curNames = () => draft.legs.flatMap(l => l.names);
function closeSegment() {
  if (draft.wps.length >= 2) draft.segs.push({ path: curPath(), names: curNames() });
  const ok = draft.wps.length >= 2;
  draft.wps = []; draft.legs = [];
  return ok;
}
function nameSummary() {
  const acc = new Map();
  for (const s of draft.segs) for (const { name, len } of s.names) if (name) acc.set(name, (acc.get(name) || 0) + len);
  const arr = [...acc].filter(([, m]) => m >= 15).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  if (arr.length <= 1) return arr[0] || '';
  return arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
}

function addPoint(ll) {
  let pt;
  if (draft.mode === 'calles' && net.ready) {
    pt = snap(ll.lat, ll.lng, CFG.snapMax);
    if (!pt) { toast('No hay ninguna calle cerca de ese punto'); return; }
  } else pt = { lat: ll.lat, lon: ll.lng };
  const last = draft.wps[draft.wps.length - 1];
  let leg = { path: [[pt.lat, pt.lon]], names: [] };
  if (last) {
    const straight = { path: [[last.lat, last.lon], [pt.lat, pt.lon]], names: [] };
    if (last.e !== undefined && pt.e !== undefined) {
      leg = route(last, pt);
      if (!leg) { toast('Esos puntos no están conectados por calles: se unen en línea recta'); leg = straight; }
    } else leg = straight;
  }
  draft.wps.push(pt); draft.legs.push(leg);
  renderDraft(); showScreen('draw');
}
function undoPoint() {
  if (draft.wps.length) { draft.wps.pop(); draft.legs.pop(); }
  else if (draft.segs.length) {                       // sin puntos en curso: quita el último tramo cerrado
    draft.segs.pop();
    toast('Último tramo eliminado');
  }
  renderDraft(); showScreen('draw');
}
function renderDraft() {
  draftLayer.clearLayers();
  if (!draft) return;
  for (const s of draft.segs) {
    L.polyline(s.path, { color: '#fff', weight: 14, opacity: .9, interactive: false }).addTo(draftLayer);
    L.polyline(s.path, { color: '#0f2a4a', weight: 7, opacity: .95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(draftLayer);
  }
  if (draft.wps.length) {
    const p = curPath();
    if (p.length > 1) {
      L.polyline(p, { color: '#fff', weight: 14, opacity: .9, interactive: false }).addTo(draftLayer);
      L.polyline(p, { color: '#1570ef', weight: 7, opacity: .95, dashArray: '10 8', interactive: false, lineCap: 'round' }).addTo(draftLayer);
    }
    draft.wps.forEach((w, i) => L.circleMarker([w.lat, w.lon], { radius: 7, weight: 3, color: i === 0 ? '#12b76a' : '#1570ef', fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(draftLayer));
  }
}
function startDraw(base) {
  draft = newDraft(base);
  state.sel = null;
  if (netLayer && net.ready) netLayer.addTo(map);
  map.getContainer().style.cursor = 'crosshair';
  renderDraft(); renderMap(); showScreen('draw');
  if (!net.ready) toast('Callejero no disponible: trazado libre');
}
function endDraw() {
  draft = null; draftLayer.clearLayers();
  if (netLayer) map.removeLayer(netLayer);
  snapDot.remove();
  map.getContainer().style.cursor = '';
}
map.on('click', e => { if (draft && draft.stage === 'draw') addPoint(e.latlng); });
if (matchMedia('(hover:hover)').matches) {
  let raf = 0;
  map.on('mousemove', e => {
    if (!draft || draft.stage !== 'draw' || draft.mode !== 'calles' || !net.ready) { snapDot.remove(); return; }
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const s = snap(e.latlng.lat, e.latlng.lng, CFG.snapMax); if (s) snapDot.setLatLng([s.lat, s.lon]).addTo(map); else snapDot.remove(); });
  });
}

/* ───────── Pantallas del panel ───────── */
const panel = $('#panel'), body = $('#panelBody');
$('#grab').onclick = () => panel.classList.toggle('min');

function showScreen(s) {
  state.screen = s;
  panel.classList.remove('min');
  ({ list: viewList, detail: viewDetail, draw: viewDraw, form: viewForm })[s]();
}
const byUrgency = (a, b) => {
  const ea = estado(a, state.view), eb = estado(b, state.view), o = { act: 0, prog: 1, fin: 2 };
  if (o[ea] !== o[eb]) return o[ea] - o[eb];
  const fa = a.fin ? +parse(a.fin) : Infinity, fb = b.fin ? +parse(b.fin) : Infinity;
  return ea === 'prog' ? +parse(a.inicio) - +parse(b.inicio) : fa - fb;
};
function legendHTML() {
  return '<div class="legend">' + Object.values(TIPOS).map(t => `<span><i style="background:${t.color}"></i>${esc(t.label)}</span>`).join('') +
    `<span><i style="background:${GREY}"></i>Finalizado</span><span><i style="background:repeating-linear-gradient(90deg,#667085 0 3px,transparent 3px 8px)"></i>Programado</span></div>`;
}

function viewList() {
  const vis = state.cortes.filter(visible).sort(byUrgency), hidden = state.cortes.length - vis.length;
  const lbl = { instante: 'vigentes en ese momento', dia: 'ese día', todos: 'en total' }[state.scope];
  body.innerHTML = `
    <div class="btns"><button class="btn pri" data-act="new">＋ Nuevo corte</button></div>
    <h2>${vis.length} ${vis.length === 1 ? 'corte' : 'cortes'} <span class="mut" style="font-weight:400">${lbl}</span></h2>
    ${vis.length ? vis.map(c => {
      const e = estado(c, state.view);
      return `<div class="item" data-act="open" data-id="${esc(c.id)}"><span class="dot" style="background:${colorOf(c, e)}"></span><div>
        <div class="t">${esc(c.calle)}</div>
        <div class="s"><span class="badge ${e}">${ESTADO_LBL[e]}</span>${esLarga(c) ? '<span class="badge long">Larga duración</span>' : ''}${esc((TIPOS[c.tipo] || {}).label || '')}</div>
        <div class="s">${esc(shortText(c, state.view))}</div></div></div>`;
    }).join('') : `<p class="mut">No hay cortes para el momento seleccionado. Pulsa «Nuevo corte» para dibujar el primero o cambia el filtro de arriba.</p>`}
    ${hidden > 0 && state.scope !== 'todos' ? `<p class="mut">${hidden} ${hidden === 1 ? 'corte más' : 'cortes más'} en otras fechas (elige «Todos los cortes»).</p>` : ''}
    ${legendHTML()}`;
}

function viewDetail() {
  const c = state.cortes.find(x => x.id === state.sel);
  if (!c) return showScreen('list');
  const e = estado(c, state.view), i = parse(c.inicio), f = parse(c.fin);
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd>` : '');
  body.innerHTML = `
    <div class="btns" style="margin-top:0"><button class="btn" data-act="back">‹ Volver</button><button class="btn" data-act="fit">Ver en el mapa</button></div>
    <h2>${esc(c.calle)}</h2>
    <div><span class="badge ${e}">${ESTADO_LBL[e]}</span>${esLarga(c) ? '<span class="badge long">Larga duración</span>' : '<span class="badge">Puntual</span>'}<span class="badge" style="background:${colorOf(c, e)};color:#fff">${esc((TIPOS[c.tipo] || {}).label || '')}</span></div>
    <div class="dur">${esc(durText(c, state.view))}</div>
    <dl class="kv">
      ${row('Tramo', c.tramo)}${row('Motivo', c.motivo)}${row('Organismo', c.organismo)}
      ${row('Inicio', i ? `${diaTxt(i, state.view)} ${hora(i)} (${i.toLocaleDateString('es-ES')})` : '')}
      ${row('Fin', f ? `${diaTxt(f, state.view)} ${hora(f)} (${f.toLocaleDateString('es-ES')})` : 'Sin fecha de fin')}
      ${row('Desvío', c.desvio)}${row('Observaciones', c.obs)}
      ${row('Longitud', fmtLen(totalLen(c.segs)) + (c.segs.length > 1 ? ` en ${c.segs.length} tramos` : ''))}
      ${row('Registrado', c.modificado ? new Date(c.modificado).toLocaleString('es-ES') : '')}
    </dl>
    <div class="btns">
      <button class="btn" data-act="edit">Editar datos</button>
      <button class="btn" data-act="redraw">Redibujar trazado</button>
      <button class="btn" data-act="dup">Duplicar</button>
      <button class="btn dng" data-act="del">Eliminar</button>
    </div>`;
}

function viewDraw() {
  const len = totalLen(draft.segs.map(s => s.path)) + (draft.wps.length > 1 ? lengthM(curPath()) : 0);
  const nseg = draft.segs.length + (draft.wps.length > 1 ? 1 : 0);
  const msg = !draft.wps.length
    ? (draft.segs.length ? 'Toca el punto de inicio de otro tramo o pulsa «Continuar».' : 'Toca en el mapa el punto donde empieza el corte.')
    : 'Toca el siguiente punto. Si la ruta no sigue la calle que quieres, añade puntos intermedios.';
  body.innerHTML = `
    <h2>${draft.id ? 'Redibujar corte' : 'Dibujar corte'}</h2>
    <div class="seg" role="tablist">
      <button data-act="mode" data-m="calles" class="${draft.mode === 'calles' ? 'on' : ''}" ${net.ready ? '' : 'disabled title="Callejero no disponible"'}>Siguiendo calles</button>
      <button data-act="mode" data-m="libre" class="${draft.mode === 'libre' ? 'on' : ''}">Trazado libre</button>
    </div>
    <div class="hint">${msg}</div>
    <div class="stat"><span>Tramos: <b>${nseg}</b></span><span>Longitud: <b>${fmtLen(len)}</b></span><span>Puntos: <b>${draft.wps.length}</b></span></div>
    <div class="btns">
      <button class="btn" data-act="undo">↶ Deshacer</button>
      <button class="btn" data-act="newseg" ${draft.wps.length >= 2 ? '' : 'disabled'}>Nuevo tramo</button>
      <button class="btn dng" data-act="clear" ${(draft.segs.length || draft.wps.length) ? '' : 'disabled'}>Borrar todo</button>
    </div>
    <div class="btns"><button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn pri" data-act="next" ${(draft.segs.length || draft.wps.length >= 2) ? '' : 'disabled'}>Continuar ›</button></div>`;
}

function opts(list, sel) { return list.map(v => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join(''); }
function viewForm() {
  const b = draft.base || {};
  const now = new Date();
  const calle = b.calle || nameSummary();
  body.innerHTML = `
    <h2>${draft.id ? 'Editar corte' : 'Datos del corte'}</h2>
    <p class="mut">${fmtLen(totalLen(draft.segs.map(s => s.path)))} en ${draft.segs.length} ${draft.segs.length === 1 ? 'tramo' : 'tramos'}.</p>
    <form id="f" autocomplete="off">
      <label>Calle(s) afectada(s) *</label><input name="calle" required value="${esc(calle)}" placeholder="Ej.: Calle Grízar">
      <label>Tramo (desde – hasta)</label><input name="tramo" value="${esc(b.tramo || '')}" placeholder="Ej.: entre C/ Santa Marta y C/ Real">
      <div class="two">
        <div><label>Tipo de afección</label><select name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${k === (b.tipo || 'total') ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div><label>Motivo</label><select name="motivo">${opts(MOTIVOS, b.motivo)}</select></div>
      </div>
      <label>Organismo que lo origina</label><select name="organismo">${opts(ORGS, b.organismo || 'Policía Local')}</select>
      <div class="two">
        <div><label>Inicio *</label><input type="datetime-local" name="inicio" required value="${esc(b.inicio || toInput(now))}"></div>
        <div><label>Fin (vacío = indefinido)</label><input type="datetime-local" name="fin" value="${esc(b.fin || '')}"></div>
      </div>
      <div class="chips" id="chips">
        <button type="button" data-h="1">+1 h</button><button type="button" data-h="2">+2 h</button><button type="button" data-h="4">+4 h</button>
        <button type="button" data-h="day">Hasta fin del día</button><button type="button" data-h="168">+1 semana</button><button type="button" data-h="0">Sin fin</button>
      </div>
      <label>Desvío recomendado</label><textarea name="desvio" placeholder="Ej.: Circular por C/ Real y Avda. de Extremadura">${esc(b.desvio || '')}</textarea>
      <label>Observaciones</label><textarea name="obs">${esc(b.obs || '')}</textarea>
      <div class="btns"><button type="button" class="btn" data-act="backdraw">‹ Trazado</button><button type="button" class="btn" data-act="cancel">Cancelar</button><button type="submit" class="btn pri">Guardar</button></div>
    </form>`;
  $('#chips').onclick = ev => {
    const h = ev.target.dataset.h; if (h === undefined) return;
    const f = $('#f'), ini = parse(f.inicio.value) || new Date();
    if (h === '0') f.fin.value = '';
    else if (h === 'day') f.fin.value = toInput(new Date(ini.getFullYear(), ini.getMonth(), ini.getDate(), 23, 59));
    else f.fin.value = toInput(new Date(+ini + (+h) * 36e5));
  };
  $('#f').onsubmit = ev => { ev.preventDefault(); saveForm(new FormData(ev.target)); };
}

function saveForm(fd) {
  const v = Object.fromEntries(fd.entries());
  v.calle = (v.calle || '').trim();
  if (!v.calle) return toast('Indica la calle afectada');
  if (!v.inicio) return toast('Indica la fecha de inicio');
  if (v.fin && parse(v.fin) < parse(v.inicio)) return toast('La fecha de fin es anterior a la de inicio');
  const nowIso = new Date().toISOString();
  const data = { calle: v.calle, tramo: v.tramo.trim(), tipo: v.tipo, motivo: v.motivo, organismo: v.organismo, inicio: v.inicio, fin: v.fin || '', desvio: v.desvio.trim(), obs: v.obs.trim(), segs: draft.segs.map(s => s.path.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)])), modificado: nowIso };
  let id = draft.id;
  if (id) Object.assign(state.cortes.find(c => c.id === id), data);
  else { id = uid(); state.cortes.push({ id, creado: nowIso, ...data }); }
  saveCortes(); endDraw();
  state.sel = id;
  // Si el corte guardado no se ve con el filtro actual, se ajusta para que aparezca.
  const c = state.cortes.find(x => x.id === id);
  if (!visible(c)) { state.scope = 'todos'; $('#scope').value = 'todos'; }
  renderMap(); showScreen('detail'); fitCorte(c); toast('Corte guardado');
}

/* ───────── Acciones ───────── */
function select(id, fit) { state.sel = id; renderMap(); showScreen('detail'); if (fit) fitCorte(state.cortes.find(c => c.id === id)); }
function cancelDraw() {
  const id = draft && draft.id; endDraw(); renderMap();
  if (id && state.cortes.some(c => c.id === id)) { state.sel = id; renderMap(); showScreen('detail'); } else showScreen('list');
}
body.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, c = state.cortes.find(x => x.id === (t.dataset.id || state.sel));
  switch (act) {
    case 'new': startDraw(null); break;
    case 'open': select(t.dataset.id, true); break;
    case 'back': state.sel = null; renderMap(); showScreen('list'); break;
    case 'fit': if (c) fitCorte(c); break;
    case 'edit': draft = newDraft(c); draft.stage = 'form'; renderMap(); showScreen('form'); break;
    case 'redraw': startDraw(c); break;
    case 'dup': {
      const copy = JSON.parse(JSON.stringify(c)); copy.id = uid(); copy.creado = copy.modificado = new Date().toISOString(); copy.calle += ' (copia)';
      state.cortes.push(copy); saveCortes(); select(copy.id, false); toast('Corte duplicado'); break;
    }
    case 'del':
      if (confirm(`¿Eliminar el corte «${c.calle}»?`)) { state.cortes = state.cortes.filter(x => x.id !== c.id); saveCortes(); state.sel = null; renderMap(); showScreen('list'); }
      break;
    case 'mode': draft.mode = t.dataset.m; if (draft.mode === 'libre') snapDot.remove(); showScreen('draw'); break;
    case 'undo': undoPoint(); break;
    case 'newseg': closeSegment(); renderDraft(); showScreen('draw'); break;
    case 'clear': draft.segs = []; draft.wps = []; draft.legs = []; renderDraft(); showScreen('draw'); break;
    case 'cancel': cancelDraw(); break;
    case 'next': closeSegment(); if (!draft.segs.length) return toast('Marca al menos dos puntos'); draft.stage = 'form'; snapDot.remove(); if (netLayer) map.removeLayer(netLayer); map.getContainer().style.cursor = ''; renderDraft(); showScreen('form'); break;
    case 'backdraw': draft.stage = 'draw'; if (netLayer && net.ready) netLayer.addTo(map); map.getContainer().style.cursor = 'crosshair'; renderDraft(); showScreen('draw'); break;
  }
});
document.addEventListener('keydown', ev => {
  if (!draft || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
  if (ev.key === 'Escape') cancelDraw();
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && draft.stage === 'draw') { ev.preventDefault(); undoPoint(); }
});

/* ───────── Barra superior ───────── */
const whenEl = $('#when'), scopeEl = $('#scope');
function syncWhen() { whenEl.value = toInput(state.view); }
function refreshAll() { renderMap(); if (state.screen === 'list') viewList(); else if (state.screen === 'detail') viewDetail(); }
whenEl.onchange = () => { if (!whenEl.value) return; state.live = false; state.view = new Date(whenEl.value); refreshAll(); };
$('#btnNow').onclick = () => { state.live = true; state.view = new Date(); syncWhen(); refreshAll(); };
scopeEl.onchange = () => { state.scope = scopeEl.value; refreshAll(); };
setInterval(() => { if (state.live && !draft) { state.view = new Date(); syncWhen(); refreshAll(); } }, 30000);

/* ───────── Menú, importar y exportar ───────── */
const menu = $('#menu');
function menuItems() {
  return [
    ['base', baseKey === 'osm' ? '🛰  Ver satélite (PNOA)' : '🗺  Ver plano de calles'],
    ['gj', '⬇  Exportar GeoJSON (copia de seguridad)'],
    ['csv', '⬇  Exportar a Excel (CSV)'],
    ['imp', '⬆  Importar GeoJSON'],
    ['print', '🖨  Imprimir / guardar PDF'],
    ['net', '↻  Actualizar callejero'],
    ['wipe', 'Borrar todos los cortes', 'red'],
    ['info', 'ℹ  Acerca de este mapa'],
  ].map(([k, t, c]) => `<button data-m="${k}" class="${c || ''}">${t}</button>`).join('');
}
$('#btnMenu').onclick = ev => { ev.stopPropagation(); menu.innerHTML = menuItems(); menu.hidden = !menu.hidden; };
document.addEventListener('click', ev => { if (!menu.hidden && !menu.contains(ev.target)) menu.hidden = true; });
menu.onclick = ev => {
  const k = ev.target.dataset.m; if (!k) return; menu.hidden = true;
  if (k === 'base') toggleBase();
  else if (k === 'gj') exportGeoJSON();
  else if (k === 'csv') exportCSV();
  else if (k === 'imp') $('#fileImport').click();
  else if (k === 'print') window.print();
  else if (k === 'net') loadNet(true);
  else if (k === 'wipe') { if (state.cortes.length && confirm(`¿Borrar los ${state.cortes.length} cortes guardados en este dispositivo? Esta acción no se puede deshacer.`)) { state.cortes = []; saveCortes(); state.sel = null; renderMap(); showScreen('list'); } }
  else if (k === 'info') alert('Cortes de calle · Policía Local de Don Benito\n\nVersión de pruebas (MVP).\n• Los cortes se guardan SOLO en este dispositivo. Para pasarlos a otro equipo o hacer copia, usa «Exportar GeoJSON» e «Importar GeoJSON».\n• Cartografía: © colaboradores de OpenStreetMap (ODbL) y PNOA © IGN.\n• Es una herramienta de apoyo visual; no sustituye a la resolución, bando o decreto que ordene el corte.');
};
function download(name, mime, text) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => toInput(new Date()).replace(/[-:T]/g, '').slice(0, 12);
function exportGeoJSON() {
  const fc = { type: 'FeatureCollection', features: state.cortes.map(c => { const { segs, ...props } = c; return { type: 'Feature', properties: props, geometry: { type: 'MultiLineString', coordinates: segs.map(p => p.map(([la, lo]) => [lo, la])) } }; }) };
  download(`cortes-don-benito-${stamp()}.geojson`, 'application/geo+json', JSON.stringify(fc, null, 1));
}
function exportCSV() {
  const cols = ['calle', 'tramo', 'tipo', 'motivo', 'organismo', 'inicio', 'fin', 'estado', 'duracion', 'desvio', 'observaciones', 'longitud_m', 'geometria_wkt'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = state.cortes.map(c => {
    const i = parse(c.inicio), f = parse(c.fin);
    const wkt = 'MULTILINESTRING(' + c.segs.map(p => '(' + p.map(([la, lo]) => `${lo} ${la}`).join(',') + ')').join(',') + ')';
    return [c.calle, c.tramo, (TIPOS[c.tipo] || {}).label, c.motivo, c.organismo, i ? i.toLocaleString('es-ES') : '', f ? f.toLocaleString('es-ES') : '', ESTADO_LBL[estado(c, new Date())], f ? span(f - i) : 'Indefinida', c.desvio, c.obs, Math.round(totalLen(c.segs)), wkt].map(q).join(';');
  });
  download(`cortes-don-benito-${stamp()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + [cols.join(';'), ...rows].join('\r\n'));
}
$('#fileImport').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  try {
    const fc = JSON.parse(await file.text());
    if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('No es un FeatureCollection');
    const num = x => typeof x === 'number' && isFinite(x);
    let added = 0, replaced = 0, skipped = 0;
    for (const f of fc.features) {
      const g = f.geometry || {};
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null;
      const segs = lines && lines.map(l => (Array.isArray(l) ? l : []).filter(p => Array.isArray(p) && num(p[0]) && num(p[1])).map(([lo, la]) => [la, lo])).filter(l => l.length > 1);
      if (!segs || !segs.length) { skipped++; continue; }
      const p = f.properties || {};
      const c = { id: String(p.id || uid()), creado: p.creado || new Date().toISOString(), modificado: new Date().toISOString(),
        calle: String(p.calle || p.name || 'Sin nombre'), tramo: String(p.tramo || ''), tipo: TIPOS[p.tipo] ? p.tipo : 'total', motivo: String(p.motivo || 'Otro'), organismo: String(p.organismo || 'Otro organismo'),
        inicio: /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(p.inicio || '') ? p.inicio : toInput(new Date()), fin: /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(p.fin || '') ? p.fin : '',
        desvio: String(p.desvio || ''), obs: String(p.obs || ''), segs };
      const k = state.cortes.findIndex(x => x.id === c.id);
      if (k >= 0) { state.cortes[k] = c; replaced++; } else { state.cortes.push(c); added++; }
    }
    saveCortes(); state.scope = 'todos'; scopeEl.value = 'todos'; renderMap(); showScreen('list');
    toast(`Importados: ${added} nuevos, ${replaced} actualizados${skipped ? ', ' + skipped + ' omitidos' : ''}`);
  } catch (err) { alert('No se pudo importar el archivo: ' + err.message); }
};

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

/* ───────── Arranque ───────── */
state.cortes = loadCortes();
syncWhen(); renderMap(); showScreen('list');
setNetChip('Callejero: …', '');
loadNet(false);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

window.__cortes = { state, net, snap, route, map }; // útil para pruebas
})();
