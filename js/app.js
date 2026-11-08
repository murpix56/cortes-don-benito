/* Cortes de calle · Policía Local de Don Benito
 * Vista ciudadana (solo lectura) + panel de agentes (alta, edición, importación, historial). */
import { $, esc, pad, uid, isUuid, toInput, parse, startOfDay, addDays, lsGet, lsSet, TIPOS, MOTIVOS, SOLICITA, AUTORIZA, GREY, ESTADO_LBL, LADOS, tipoTexto,
  estado, esLarga, durText, shortText, diaTxt, hora, horaCorta, cuando, fechaInput, horaInput, fmtDT, span, totalLen, lengthM, fmtLen, normKey, toast } from './util.js?v=20261108g';
import * as store from './store.js?v=20261108g';
import { net, CFG, loadNet, snap, route, searchStreets, streetBounds, crossNames } from './net.js?v=20261108g';
import * as imp from './importer.js?v=20261108g';

const S = {
  mode: null, cortes: [], view: new Date(), when: 'ahora', fecha: null, listOpen: null,
  sel: null, screen: 'list', tab: 'cortes', q: '', ftipo: '', faut: '',
  imp: null, log: null, stale: null, netChip: { txt: '', cls: '' },
};
let draft = null;
const BASE_KEY = 'cortes.base';

/* ───────── Escudo ───────── */
const SHIELD_SVG = '<svg viewBox="0 0 64 72" aria-hidden="true"><path d="M32 3 6 12v22c0 17 11 30 26 35 15-5 26-18 26-35V12z" fill="#173a63" stroke="#c8a44d" stroke-width="3"/><path d="M32 20l4.4 9 9.9 1.4-7.2 7 1.7 9.8L32 42.5l-8.8 4.7 1.7-9.8-7.2-7 9.9-1.4z" fill="#c8a44d"/></svg>';
const escudo = cls => `<img class="escudo ${cls || ''}" src="escudo.png" alt="Escudo de la Policía Local de Don Benito">`;
// Si no existe escudo.png se muestra un emblema genérico (no es el escudo oficial).
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && t.classList.contains('escudo')) {
    const w = document.createElement('span'); w.className = t.className + ' fallback'; w.innerHTML = SHIELD_SVG; t.replaceWith(w);
  }
}, true);

/* ───────── Mapa ───────── */
const map = L.map('map', { zoomControl: false, attributionControl: false }).setView(CFG.center, CFG.zoom);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.attribution({ position: 'topleft', prefix: false }).addTo(map);   // arriba: la tarjeta flotante no debe taparla
const bases = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
  sat: L.tileLayer('https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0&layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&format=image/jpeg&tilematrix={z}&tilerow={y}&tilecol={x}', { maxZoom: 19, attribution: 'PNOA © <a href="https://www.ign.es">IGN</a>' }),
};
let baseKey = lsGet(BASE_KEY, 'osm'); if (!bases[baseKey]) baseKey = 'osm';
bases[baseKey].addTo(map);
function toggleBase() { map.removeLayer(bases[baseKey]); baseKey = baseKey === 'osm' ? 'sat' : 'osm'; bases[baseKey].addTo(map); bases[baseKey].bringToBack(); lsSet(BASE_KEY, baseKey); }
new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());

const cortesLayer = L.featureGroup().addTo(map);
const draftLayer = L.featureGroup().addTo(map);
let netLayer = null, netLayerFor = null;
const snapDot = L.circleMarker([0, 0], { radius: 7, color: '#1570ef', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false });
function showNetLayer() {
  if (!net.ready) return;
  if (!netLayer || netLayerFor !== net.lines) { if (netLayer) map.removeLayer(netLayer); netLayer = L.polyline(net.lines, { color: '#475467', weight: 2, opacity: .55, interactive: false }); netLayerFor = net.lines; }
  netLayer.addTo(map);
}
const hideNetLayer = () => { if (netLayer) map.removeLayer(netLayer); };

/* ───────── Filtros y visibilidad ───────── */
const overlap = (c, d0, d1) => { const i = parse(c.inicio), f = parse(c.fin); return (!i || i < d1) && (!f || f >= d0); };
function visible(c) {
  const t = S.view;
  if (S.mode === 'citizen') return estado(c, t) === 'act';
  if (S.when === 'todos') return true;
  if (S.when === 'ahora') return estado(c, t) === 'act';
  const d0 = S.when === 'hoy' ? startOfDay(t) : S.when === 'manana' ? addDays(startOfDay(t), 1) : startOfDay(parse((S.fecha || fechaInput(t)) + 'T00:00'));
  return overlap(c, d0, addDays(d0, 1));
}
function matchesFilters(c) {
  if (S.q) { const q = normKey(S.q); if (!normKey(`${c.calle} ${c.tramo} ${c.motivo}`).includes(q)) return false; }
  if (S.mode === 'agent') { if (S.ftipo && c.tipo !== S.ftipo) return false; if (S.faut && c.autoriza !== S.faut) return false; }
  return true;
}
const byUrgency = (a, b) => {
  const ea = estado(a, S.view), eb = estado(b, S.view), o = { act: 0, prog: 1, fin: 2 };
  if (o[ea] !== o[eb]) return o[ea] - o[eb];
  const fa = a.fin ? +parse(a.fin) : Infinity, fb = b.fin ? +parse(b.fin) : Infinity;
  return ea === 'prog' ? +parse(a.inicio) - +parse(b.inicio) : fa - fb;
};
const shown = () => S.cortes.filter(c => visible(c) && matchesFilters(c)).sort(byUrgency);
const colorOf = (c, e) => (e === 'fin' ? GREY : (TIPOS[c.tipo] || TIPOS.total).color);

/* ───────── Dibujo de cortes en el mapa ───────── */
function renderMap() {
  cortesLayer.clearLayers();
  if (S.mode === 'landing') return;
  for (const c of (S.mode === 'citizen' ? S.cortes.filter(x => (estado(x, S.view) === 'act' && matchesFilters(x)) || x.id === S.sel) : shown())) {
    if (draft && draft.id === c.id) continue;
    const e = estado(c, S.view), col = colorOf(c, e), sel = c.id === S.sel, unpub = c.publicado === false;
    if (sel) L.polyline(c.segs, { color: col, weight: 22, opacity: .28, interactive: false, lineCap: 'round' }).addTo(cortesLayer);
    const casing = L.polyline(c.segs, { color: '#fff', weight: 15, opacity: .9, lineCap: 'round', lineJoin: 'round' }).addTo(cortesLayer);
    L.polyline(c.segs, { color: col, weight: 8, opacity: unpub ? .55 : 1, dashArray: e === 'prog' ? '2 12' : unpub ? '10 8' : null, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(cortesLayer);
    casing.bindTooltip(`<i class="d" style="background:${col}"></i><span><b>${esc(c.calle)}</b>${c.tramo ? `<small>${esc(c.tramo)}</small>` : ''}${c.tipo !== 'total' ? `<small class="k">${esc((TIPOS[c.tipo] || {}).human)}</small>` : ''}${ladoTxt(c) ? `<small>${esc(ladoTxt(c))}</small>` : ''}<small class="w">${esc(cuando(c, S.view).principal)}</small>${unpub ? '<small>Sin publicar</small>' : ''}</span>`, { sticky: true, className: 'tt', direction: 'top', offset: [0, -6] });
    casing.on('click', ev => { if (draft) return; L.DomEvent.stopPropagation(ev); select(c.id, true); });
  }
}
const encuadrar = (puntos, maxZoom = 18) => map.fitBounds(L.latLngBounds(puntos), { maxZoom, paddingTopLeft: [30, S.mode === 'citizen' ? (innerWidth < 700 ? 150 : 90) : 30], paddingBottomRight: [30, 30 + (S.mode === 'citizen' ? panel.offsetHeight : 0)] });
const fitCorte = c => encuadrar(c.segs.flat());

/* ───────── Estado del callejero ───────── */
function setNetChip(txt, cls) {
  S.netChip = { txt, cls };
  const el = $('#netchip'); if (el) { el.textContent = txt; el.className = 'netchip ' + (cls || ''); }
  if (net.ready && S.mode === 'agent' && draft && draft.stage === 'draw') showNetLayer();
}

/* ───────── Borrador de trazado ───────── */
function newDraft(base) {
  return { id: (base && base.id) || null, base: base || null, mode: net.ready ? 'calles' : 'libre', stage: 'draw', fromImport: null,
    segs: base && base.segs ? base.segs.map(p => ({ path: p, names: [] })) : [], wps: [], legs: [] };
}
/* Quita los rebotes: ir hasta un punto pasado el cruce y volver por el mismo sitio */
function sinRebotes(p) { const o = []; for (const q of p) { const n = o.length; if (n >= 2 && o[n - 2][0] === q[0] && o[n - 2][1] === q[1]) o.pop(); else o.push(q); } return o; }
const curPath = () => sinRebotes(draft.legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1))));
const curNames = () => draft.legs.flatMap(l => l.names);
function closeSegment() {
  const ok = draft.wps.length >= 2;
  if (ok) draft.segs.push({ path: curPath(), names: curNames() });
  draft.wps = []; draft.legs = []; return ok;
}
function nameSummary() {
  const acc = new Map();
  for (const s of draft.segs) for (const { name, len } of s.names) if (name) acc.set(name, (acc.get(name) || 0) + len);
  const arr = [...acc].filter(([, m]) => m >= 15).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  return arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
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
  else if (draft.segs.length) { draft.segs.pop(); toast('Último tramo eliminado'); }
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
function startDraw(base, fromImport) {
  draft = newDraft(base); draft.fromImport = fromImport || null;
  S.sel = null; showNetLayer();
  map.getContainer().style.cursor = 'crosshair';
  renderDraft(); renderMap(); showScreen('draw');
  if (!net.ready) toast('Callejero no disponible: trazado libre');
}
function endDraw() {
  draft = null; draftLayer.clearLayers(); hideNetLayer(); snapDot.remove(); map.getContainer().style.cursor = '';
}
map.on('click', e => { if (S.mode === 'agent' && draft && draft.stage === 'draw') addPoint(e.latlng); });
if (matchMedia('(hover:hover)').matches) {
  let raf = 0;
  map.on('mousemove', e => {
    if (!draft || draft.stage !== 'draw' || draft.mode !== 'calles' || !net.ready) { snapDot.remove(); return; }
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const s = snap(e.latlng.lat, e.latlng.lng, CFG.snapMax); if (s) snapDot.setLatLng([s.lat, s.lon]).addTo(map); else snapDot.remove(); });
  });
}

/* ───────── Desplegable propio: mismo diseño en toda la aplicación ───────── */
const ddHTML = (id, name, value, options) => {
  const cur = options.find(o => o[0] === value) || options[0];
  return `<div class="dd" data-dd><input type="hidden" id="${id}" name="${name}" value="${esc(cur[0])}"><button type="button" class="ddb" aria-haspopup="listbox" aria-expanded="false"><span>${esc(cur[1])}</span><i class="chev">⌄</i></button>
    <ul class="ddl" role="listbox" hidden>${options.map(([v, l]) => `<li role="option" data-v="${esc(v)}" class="${v === cur[0] ? 'on' : ''}">${esc(l)}</li>`).join('')}</ul></div>`;
};
document.addEventListener('click', ev => {
  const dd = ev.target.closest('[data-dd]');
  document.querySelectorAll('[data-dd] .ddl:not([hidden])').forEach(l => { if (!dd || l.parentElement !== dd) { l.hidden = true; l.parentElement.querySelector('.ddb').setAttribute('aria-expanded', 'false'); } });
  if (!dd) return;
  const li = ev.target.closest('.ddl li'), btn = dd.querySelector('.ddb'), lst = dd.querySelector('.ddl');
  if (li) {
    const inp = dd.querySelector('input'); inp.value = li.dataset.v; dd.querySelector('.ddb span').textContent = li.textContent;
    dd.querySelectorAll('li').forEach(x => x.classList.toggle('on', x === li)); lst.hidden = true; btn.setAttribute('aria-expanded', 'false');
    inp.dispatchEvent(new Event('change', { bubbles: true })); return;
  }
  if (ev.target.closest('.ddb')) { lst.hidden = !lst.hidden; btn.setAttribute('aria-expanded', String(!lst.hidden)); if (!lst.hidden) lst.scrollIntoView({ block: 'nearest' }); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') document.querySelectorAll('[data-dd] .ddl:not([hidden])').forEach(l => { l.hidden = true; }); });

/* ───────── Panel ───────── */
const panel = $('#panel'), body = $('#panelBody');
$('#grab').onclick = () => panel.classList.toggle('min');
$('#pshow').onclick = () => document.body.classList.remove('panel-off');
function showScreen(s) {
  S.screen = s; panel.classList.remove('min');
  const v = { list: S.mode === 'citizen' ? viewCitizen : ({ cortes: viewAgent, import: viewImport, log: viewLog, users: viewUsers, system: viewSystem })[S.tab], detail: viewDetail, draw: viewDraw, form: viewForm }[s];
  v(); body.scrollTop = 0;
}
const opts = (list, sel, blank) => (blank ? '<option value="">Seleccionar…</option>' : '') + [...new Set([...list, ...(sel && !list.includes(sel) ? [sel] : [])])].map(v => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const GEAR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const ladoTxt = c => { if (c.tipo === 'total') return ''; if (c.lado === 'pares' || c.lado === 'impares') return cap(LADOS[c.lado]); return c.tipo === 'estac' ? 'Ambos lados' : ''; };
function rowHTML(c) {
  const e = estado(c, S.view), w = cuando(c, S.view), T = TIPOS[c.tipo] || TIPOS.total, ld = ladoTxt(c);
  return `<div class="row${e === 'fin' ? ' done' : ''}" data-act="open" data-id="${esc(c.id)}"><i class="bar" style="background:${colorOf(c, e)}"></i>
    <div class="rb"><b>${esc(c.calle)}</b>${c.tramo ? `<span class="sub">${esc(c.tramo)}</span>` : ''}${ld ? `<span class="sub">${esc(ld)}</span>` : ''}<span class="un">${esc(w.principal)}</span></div>
    ${c.publicado === false ? '<div class="flags"><em class="flag bad">Sin publicar</em></div>' : ''}<i class="chev">›</i></div>`;
}
const itemsHTML = () => {
  const l = shown();
  return l.length ? l.map(rowHTML).join('') : `<p class="empty">${S.q ? 'No hay resultados para esa búsqueda.' : 'No hay cortes en este periodo.'}</p>`;
};
function refreshItems() { const el = $('#listItems'); if (el) el.innerHTML = itemsHTML(); }

/* — Vista ciudadana: tarjeta flotante sobre el mapa — */
const cortoHasta = (c, now) => {
  const e = estado(c, now), i = parse(c.inicio), f = parse(c.fin), dia = d => { const t = diaTxt(d, now); return t === 'hoy' ? '' : t + ' '; };
  if (e === 'prog') return `Desde ${dia(i)}${horaCorta(i)} h`;
  return f ? `Hasta ${dia(f)}${horaCorta(f)} h` : 'Sin hora de fin';
};
function frowHTML(c, ctx) {
  const e = estado(c, S.view), T = TIPOS[c.tipo] || TIPOS.total, prog = e === 'prog', ld = ladoTxt(c);
  const verTipo = ctx === 'prox' ? c.tipo !== 'total' : c.tipo === 'parcial';   // en «Prohibido estacionar» el título de la sección ya lo dice
  return `<div class="frow" data-act="open" data-id="${esc(c.id)}"><div class="fl2"><b>${esc(c.calle)}</b>${c.tramo ? `<span>${esc(c.tramo)}</span>` : ''}${verTipo ? `<span class="tp" style="color:${T.color}">${esc(T.human)}</span>` : ''}${ld ? `<span>${esc(ld)}</span>` : ''}</div>
    <span class="when${prog ? ' prog' : ''}">${esc(cortoHasta(c, S.view))}</span></div>`;
}
function viewCitizen() {
  const now = S.view, q = (S.q || '').trim();
  const vivos = S.cortes.filter(c => estado(c, now) === 'act' && matchesFilters(c)).sort(byUrgency);
  const cortes = vivos.filter(c => c.tipo !== 'estac'), estac = vivos.filter(c => c.tipo === 'estac');
  const prox = S.cortes.filter(c => estado(c, now) === 'prog' && parse(c.inicio) < addDays(now, 7) && matchesFilters(c)).sort(byUrgency);
  const n = cortes.length, total = vivos.length + prox.length, hay = total > 0, open = S.listOpen === true || !!q;
  const titulo = q ? (hay ? `${total} ${total === 1 ? 'resultado' : 'resultados'} para «${q}»` : `Sin cortes en «${q}»`)
    : (n === 0 ? 'No hay cortes de calle ahora mismo' : n === 1 ? '1 corte activo' : n + ' cortes activos');
  const extra = !q ? [estac.length ? `${estac.length} prohibido estacionar` : '', prox.length ? `${prox.length} ${prox.length === 1 ? 'previsto' : 'previstos'}` : ''].filter(Boolean).join(' · ') : '';
  body.innerHTML = `
    ${S.stale ? `<div class="warn">Sin conexión. Datos guardados a las ${horaCorta(new Date(S.stale))}.</div>` : ''}
    <div class="fhead"><i class="live ${n || (q && hay) ? 'on' : 'ok'}"></i><div class="ft"><b>${esc(titulo)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</div>
      ${hay && !q ? `<button class="tg" data-act="toggle">${open ? 'Ocultar' : 'Ver'} <i class="chev ${open ? 'up' : ''}">⌄</i></button>` : ''}</div>
    ${q && !hay ? '<p class="okmsg">Tu calle no tiene ningún corte ni restricción activa ahora mismo.</p>' : ''}
    ${open && hay ? `${cortes.length ? `<div class="flist">${cortes.map(c => frowHTML(c)).join('')}</div>` : ''}
      ${estac.length ? `<h3 class="sec"><i class="live" style="background:${TIPOS.estac.color}"></i>Prohibido estacionar</h3><div class="flist">${estac.map(c => frowHTML(c, 'estac')).join('')}</div>` : ''}
      ${prox.length ? `<h3 class="sec">Próximamente</h3><div class="flist">${prox.map(c => frowHTML(c, 'prox')).join('')}</div>` : ''}` : ''}
    <p class="foot">Información orientativa. Respete la señalización y las indicaciones de los agentes.</p>`;
}

/* — Panel de agentes — */
const TABS = [['cortes', 'Cortes', 'cortes.ver'], ['import', 'Importar', 'cortes.importar'], ['log', 'Auditoría', 'auditoria.ver'], ['users', 'Usuarios', ['usuarios.todos', 'usuarios.agentes']], ['system', 'Sistema', 'sistema']];
const tabOK = p => (Array.isArray(p) ? p.some(x => store.can(x)) : store.can(p));
const tabsHTML = () => `<div class="tabs">${TABS.filter(t => tabOK(t[2])).map(([k, l]) => `<button data-act="tab" data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const ribbonHTML = () => (store.isRemote() ? '' : '<div class="ribbon">Modo de pruebas: los datos se guardan solo en este dispositivo.</div>');
function viewAgent() {
  const now = S.view, all = S.cortes;
  const act = all.filter(c => estado(c, now) === 'act').length, prog = all.filter(c => estado(c, now) === 'prog').length, sinpub = all.filter(c => c.publicado === false).length;
  const fechaLarga = S.fecha ? new Date(S.fecha + 'T00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '') : 'Elegir fecha';
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}
    <div class="newrow">${store.can('cortes.crear') ? '<button class="btn pri big" data-act="new">＋ Nuevo corte</button>' : ''}<button class="btn sq" data-act="print" title="Parte para imprimir (PDF)" aria-label="Parte para imprimir">🖨</button></div>
    <div class="period">${ddHTML('periodo', 'periodo', S.when, [['ahora', 'Ahora mismo'], ['hoy', 'Hoy'], ['manana', 'Mañana'], ['fecha', 'Otra fecha'], ['todos', 'Todos (incluye finalizados)']])}
      ${S.when === 'fecha' ? `<label class="ddb dateb"><span>${esc(fechaLarga)}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><input type="date" id="fechaSel" value="${esc(S.fecha || '')}" aria-label="Elegir una fecha"></label>` : ''}</div>
    <div class="sumline"><span><b>${act}</b> activos</span><span><b>${prog}</b> programados</span>${sinpub ? `<span class="warnc"><b>${sinpub}</b> sin publicar</span>` : ''}</div>
        <input id="q" class="search" type="search" placeholder="Buscar calle…" value="${esc(S.q)}" autocomplete="off">
    <details class="more"><summary>Más filtros</summary><div class="filters">
      ${ddHTML('ftipo', 'ftipo', S.ftipo, [['', 'Todos los tipos'], ...Object.entries(TIPOS).map(([k, v]) => [k, v.human])])}
      ${ddHTML('faut', 'faut', S.faut, [['', 'Autoriza: todos'], ...AUTORIZA.map(x => [x, x])])}</div></details>
    <div id="listItems" class="cards">${itemsHTML()}</div>
    <div class="legrow"><b>Leyenda</b>${Object.values(TIPOS).map(t => `<span><s style="background:${t.color}"></s>${esc(t.human)}</span>`).join('')}<span><s class="dash"></s>Programado</span><span><s style="background:${GREY}"></s>Finalizado</span></div>`;
}

/* — Ficha — */
function viewDetail() {
  const c = S.cortes.find(x => x.id === S.sel);
  if (!c) return showScreen('list');
  const ag = S.mode === 'agent', e = estado(c, S.view), T = TIPOS[c.tipo] || TIPOS.total, col = colorOf(c, e), w = cuando(c, S.view);
  const i = parse(c.inicio), f = parse(c.fin), fl = d => `${diaTxt(d, S.view)} ${horaCorta(d)}`;
  const ln = (k, v) => (v ? `<div class="ln"><span>${k}</span><b>${esc(v).replace(/\n/g, '<br>')}</b></div>` : '');
  const sec = w.secundario || (ag && e === 'act' && i ? 'Desde ' + fl(i) : '');
  body.innerHTML = `
    <div class="dtop"><button class="lnk" data-act="back">‹ Volver</button>${ag ? '<button class="lnk" data-act="fit">Ver en el mapa</button>' : '<button class="lnk" data-act="share">Compartir</button>'}</div>
    <div class="dhead" style="background:${col}"><h2>${esc(c.calle)}</h2>${c.tramo ? `<p>${esc(c.tramo)}</p>` : ''}<div class="dtype"><b>${esc(e === 'fin' ? 'Finalizado' : T.human)}</b>${ladoTxt(c) ? `<span>${esc(ladoTxt(c))}</span>` : ''}</div></div>
    ${ag && c.publicado === false ? '<div class="warn">Este corte <b>no es visible</b> para los ciudadanos.</div>' : ''}
    <p class="until2">${esc(w.principal)}</p>${sec ? `<p class="until2 sec">${esc(sec)}</p>` : ''}
    <div class="lns">${ln('Desvío', c.desvio)}${ln('Motivo', c.motivo)}${ln('Autoriza', [c.autoriza, c.autoriza_detalle].filter(Boolean).join(' · '))}</div>
    ${ag ? `<details class="more"><summary>Datos internos</summary><div class="lns">${ln('Referencia', c.referencia)}${ln('Agente', c.firma)}${ln('Notas', c.obs)}${ln('Longitud', fmtLen(totalLen(c.segs)) + (c.segs.length > 1 ? ` · ${c.segs.length} tramos` : ''))}${ln('Público', c.publicado === false ? 'No visible' : 'Visible')}${ln('Origen', c.origen === 'importado' ? 'Importado de archivo' : 'Manual')}${ln('Creado por', c.creado_por)}${ln('Modificado', c.modificado ? new Date(c.modificado).toLocaleString('es-ES') + (c.modificado_por ? ' · ' + c.modificado_por : '') : '')}</div></details>
    <div class="acts">${store.can('cortes.editar') ? '<button class="btn pri" data-act="edit">Editar</button>' : ''}${store.can('cortes.publicar') ? `<button class="btn" data-act="pub">${c.publicado === false ? 'Publicar' : 'Retirar de lo público'}</button>` : ''}</div>
    <details class="more"><summary>Más acciones</summary><div class="btns">${store.can('cortes.editar') ? '<button class="btn" data-act="redraw">Redibujar trazado</button>' : ''}${store.can('cortes.crear') ? '<button class="btn" data-act="dup">Duplicar</button>' : ''}${store.can('cortes.borrar') ? '<button class="btn dng" data-act="del">Eliminar</button>' : ''}</div></details>` : ''}`;
}

/* — Dibujo — */
function viewDraw() {
  const len = totalLen(draft.segs.map(s => s.path)) + (draft.wps.length > 1 ? lengthM(curPath()) : 0);
  const nseg = draft.segs.length + (draft.wps.length > 1 ? 1 : 0);
  const msg = !draft.wps.length
    ? (draft.segs.length ? 'Toca el inicio de otro tramo o pulsa «Continuar».' : 'Toca en el mapa el punto donde empieza el corte.')
    : 'Toca el siguiente punto. Si la ruta no sigue la calle que quieres, añade puntos intermedios.';
  body.innerHTML = `
    <h2>${draft.id ? 'Redibujar corte' : 'Dibujar corte'}</h2>
    <div class="seg" role="tablist">
      <button data-act="mode" data-m="calles" class="${draft.mode === 'calles' ? 'on' : ''}" ${net.ready ? '' : 'disabled title="Callejero no disponible"'}>Siguiendo calles</button>
      <button data-act="mode" data-m="libre" class="${draft.mode === 'libre' ? 'on' : ''}">Trazado libre</button>
    </div>
    ${net.ready ? '<input id="stq" class="search" list="stlist" placeholder="Ir a una calle…" autocomplete="off"><datalist id="stlist"></datalist>' : ''}
    <div class="hint">${msg}</div>
    <div class="statl"><span>Tramos: <b>${nseg}</b></span><span>Longitud: <b>${fmtLen(len)}</b></span><span>Puntos: <b>${draft.wps.length}</b></span></div>
    ${draft.segs.length ? `<div class="chips">${draft.segs.map((s, i) => `<button type="button" data-act="delseg" data-i="${i}" title="Quitar este tramo">Tramo ${i + 1} · ${fmtLen(lengthM(s.path))} ✕</button>`).join('')}</div>` : ''}
    <div class="btns">
      <button class="btn" data-act="undo">↶ Deshacer</button>
      <button class="btn" data-act="newseg" ${draft.wps.length >= 2 ? '' : 'disabled'}>Nuevo tramo</button>
      <button class="btn dng" data-act="clear" ${(draft.segs.length || draft.wps.length) ? '' : 'disabled'}>Borrar todo</button>
    </div>
    <div class="btns"><button class="btn" data-act="cancel">Cancelar</button>
      <button class="btn pri" data-act="next" ${(draft.segs.length || draft.wps.length >= 2) ? '' : 'disabled'}>Continuar ›</button></div>`;
}

/* — Formulario — */
function tramoSugerido() {
  if (!net.ready || !draft.segs.length) return '';
  const p0 = draft.segs[0].path[0], ult = draft.segs[draft.segs.length - 1].path, p1 = ult[ult.length - 1];
  const A = crossNames(p0[0], p0[1]), B = crossNames(p1[0], p1[1]);
  return A && B && A !== B ? `Entre ${A} y ${B}` : '';
}
const redondear5 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), Math.floor(d.getMinutes() / 5) * 5);
function viewForm() {
  const b = draft.base || {}, calle = b.calle || nameSummary();
  const ini = b.inicio ? parse(b.inicio) : redondear5(new Date());
  const fin = b.fin ? parse(b.fin) : (b.inicio ? null : new Date(+ini + 2 * 36e5)), sinFin = !fin;
  const aut = AUTORIZA.includes(b.autoriza) ? b.autoriza : '', tipo = TIPOS[b.tipo] ? b.tipo : 'total', lado = b.lado || (tipo === 'estac' ? 'ambos' : '');
  body.innerHTML = `
    <h2>${draft.id ? 'Editar corte' : 'Nuevo corte'}</h2>
    <p class="mut small">${fmtLen(totalLen(draft.segs.map(s => s.path)))} marcados en el mapa${draft.segs.length > 1 ? ` · ${draft.segs.length} tramos` : ''}</p>
    <form id="f" autocomplete="off">
      <label class="fl">Calle(s) *</label><input name="calle" required value="${esc(calle)}" placeholder="Ej.: Calle Grízar">
      <label class="fl">Tramo</label><input name="tramo" value="${esc(b.tramo || tramoSugerido())}" placeholder="Ej.: entre C/ Santa Marta y C/ Real">
      <label class="fl">Tipo de corte</label>
      <div class="choices c2 tipos">${Object.entries(TIPOS).map(([k, v]) => `<label><input type="radio" name="tipo" value="${k}"${k === tipo ? ' checked' : ''}><span><i style="background:${v.color}"></i>${esc(v.human)}</span></label>`).join('')}</div>
      <div id="ladoBox"${tipo === 'total' ? ' hidden' : ''}>
        <label class="fl" id="ladoLbl">${tipo === 'parcial' ? '¿Qué carril se corta? *' : '¿Qué lado?'}</label>
        <div class="choices c3">${[['ambos', 'Ambos lados'], ['pares', 'Pares'], ['impares', 'Impares']].map(([k, l]) => `<label data-l="${k}"${k === 'ambos' && tipo === 'parcial' ? ' hidden' : ''}><input type="radio" name="lado" value="${k}"${k === lado ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <p class="mut small">Según la numeración de los portales de la calle.</p></div>
      <label class="fl">Motivo</label>${ddHTML('motivo', 'motivo', b.motivo || MOTIVOS[0], [...new Set([...MOTIVOS, ...(b.motivo && !MOTIVOS.includes(b.motivo) ? [b.motivo] : [])])].map(m => [m, m]))}
      <label class="fl">Quién autoriza *</label>
      <div class="choices c2">${AUTORIZA.map(a => `<label><input type="radio" name="autoriza" value="${esc(a)}"${a === aut ? ' checked' : ''}><span>${esc(a)}</span></label>`).join('')}</div>
      <label class="fl">Cuándo</label>
      <div class="when2">
        <div class="wbox"><small>Desde</small><input type="date" name="ini_f" required value="${fechaInput(ini)}"><input type="time" name="ini_h" required value="${horaInput(ini)}"></div>
        <div class="wbox"><small>Hasta</small><input type="date" name="fin_f" value="${fin ? fechaInput(fin) : ''}" ${sinFin ? 'disabled' : ''}><input type="time" name="fin_h" value="${fin ? horaInput(fin) : ''}" ${sinFin ? 'disabled' : ''}>
          <label class="chk"><input type="checkbox" name="sinfin" ${sinFin ? 'checked' : ''}> Sin fecha de fin</label></div>
      </div>
      <label class="fl">Desvío <span class="opt">(opcional)</span></label><textarea name="desvio" placeholder="Ej.: Circular por C/ Real y Avda. de Extremadura">${esc(b.desvio || '')}</textarea>
      <details class="more"><summary>Más datos <span class="opt">(opcional, uso interno)</span></summary>
        <label class="fl">Detalle de la autorización <span class="opt">(se muestra al público)</span></label><input name="autoriza_detalle" value="${esc(b.autoriza_detalle || '')}" placeholder="Ej.: Decreto 123/2026">
        <label class="fl">Referencia / expediente</label><input name="referencia" value="${esc(b.referencia || '')}">
        <label class="fl">Agente que registra (n.º de identificación)</label><input name="firma" value="${esc(b.firma || '')}">
        <label class="fl">Notas internas</label><textarea name="obs">${esc(b.obs || '')}</textarea></details>
      <label class="switch"><input type="checkbox" name="publicado" ${b.publicado === false ? '' : 'checked'}><span class="trk"></span><span>Publicar para los ciudadanos</span></label>
      <div class="fbar"><button type="button" class="btn" data-act="backdraw">‹ Trazado</button><button type="button" class="btn" data-act="cancel">Cancelar</button><button type="submit" class="btn pri">Guardar</button></div>
    </form>`;
  const f = $('#f');
  const juntar = (a, h) => (f[a].value && f[h].value ? new Date(f[a].value + 'T' + f[h].value) : null);
  f.onchange = ev => {
    const n = ev.target.name;
    if (n === 'tipo') {
      const t = ev.target.value, box = $('#ladoBox'); box.hidden = t === 'total';
      box.querySelector('[data-l=ambos]').hidden = t === 'parcial'; $('#ladoLbl').textContent = t === 'parcial' ? '¿Qué carril se corta? *' : '¿Qué lado?';
      const ck = f.querySelector('[name=lado]:checked');
      if (t === 'parcial' && ck && ck.value === 'ambos') ck.checked = false; if (t === 'estac' && !f.querySelector('[name=lado]:checked')) f.querySelector('[name=lado][value=ambos]').checked = true;
    }
    if (n === 'sinfin') { ['fin_f', 'fin_h'].forEach(k => { f[k].disabled = ev.target.checked; }); if (!ev.target.checked && !f.fin_f.value) { const d = new Date((juntar('ini_f', 'ini_h') || new Date()).getTime() + 36e5); f.fin_f.value = fechaInput(d); f.fin_h.value = horaInput(d); } }
    if ((n === 'ini_f' || n === 'ini_h') && !f.sinfin.checked) { const a = juntar('ini_f', 'ini_h'), z = juntar('fin_f', 'fin_h'); if (a && (!z || z < a)) { const d = new Date(+a + 36e5); f.fin_f.value = fechaInput(d); f.fin_h.value = horaInput(d); } }
  };
  f.onsubmit = ev => { ev.preventDefault(); saveForm(new FormData(ev.target)); };
}
async function saveForm(fd) {
  const v = Object.fromEntries(fd.entries());
  v.calle = (v.calle || '').trim();
  if (!v.calle) return toast('Indica la calle afectada');
  if (!v.autoriza) return toast('Indica quién autoriza el corte');
  if ((v.tipo || 'total') === 'parcial' && !v.lado) return toast('Indica qué carril se corta: números pares o impares');
  if (!v.ini_f || !v.ini_h) return toast('Indica cuándo empieza');
  const inicio = `${v.ini_f}T${v.ini_h}`;
  let fin = '';
  if (v.sinfin !== 'on') {
    if (!v.fin_f || !v.fin_h) return toast('Indica hasta cuándo o marca «Sin fecha de fin»');
    fin = `${v.fin_f}T${v.fin_h}`;
    if (fin < inicio) return toast('El corte termina antes de empezar');
  }
  const data = {
    calle: v.calle, tramo: (v.tramo || '').trim(), tipo: v.tipo || 'total', lado: (v.tipo || 'total') === 'total' ? '' : (v.lado || ''), motivo: v.motivo, autoriza: v.autoriza, autoriza_detalle: (v.autoriza_detalle || '').trim(),
    referencia: (v.referencia || '').trim(), firma: (v.firma || '').trim(), inicio, fin, desvio: (v.desvio || '').trim(), obs: (v.obs || '').trim(), publicado: v.publicado === 'on',
    segs: draft.segs.map(s => s.path.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)])),
  };
  const prev = draft.id ? S.cortes.find(c => c.id === draft.id) : null;
  const id = draft.id || uid();
  const corte = prev ? { ...prev, ...data } : { id, origen: (draft.base && draft.base.origen) || 'manual', organismo: '', ...data };
  try { await store.save(corte); }
  catch (e) { return toast('No se pudo guardar: ' + e.message); }
  if (draft.fromImport && S.imp) S.imp.items = S.imp.items.filter(x => x !== draft.fromImport);
  endDraw(); await reload();
  S.sel = id; const c = S.cortes.find(x => x.id === id);
  if (c && !visible(c)) { S.when = 'todos'; S.ftipo = S.faut = S.q = ''; }
  renderMap(); showScreen('detail'); if (c) fitCorte(c); toast('Corte guardado');
}

/* — Importar — */
function viewImport() {
  const I = S.imp;
  let h = `${ribbonHTML()}${tabsHTML()}<h2>Importar desde Excel / CSV</h2>`;
  if (!I || !I.table) {
    h += `<p class="mut">Sube la exportación de VinfoPol u otro listado en Excel (.xlsx) o CSV. La aplicación localiza cada corte en el mapa por el nombre de la calle y los cruces «desde / hasta». Los cortes importados <b>quedan sin publicar</b> hasta que los revises.</p>
      <div class="btns"><button class="btn pri" data-act="imp-choose">Elegir archivo…</button><button class="btn" data-act="imp-template">Descargar plantilla</button></div>
      ${net.ready ? '' : '<div class="warn">El callejero no está cargado: sin él no se pueden localizar los cortes.</div>'}`;
  } else if (!I.items) {
    h += `<p class="mut"><b>${esc(I.name)}</b> · ${I.table.rows.length} filas. Comprueba qué columna corresponde a cada dato:</p><div class="map">` +
      imp.FIELDS.map(f => `<label>${esc(f.label)}${f.req ? ' *' : ''}</label><select data-fmap="${f.k}"><option value="">— no usar —</option>${I.table.headers.map((x, i) => `<option value="${i}"${I.map[f.k] === i ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`).join('') +
      `</div><div class="btns"><button class="btn" data-act="imp-reset">Cancelar</button><button class="btn pri" data-act="imp-run" ${net.ready ? '' : 'disabled'}>Procesar filas ›</button></div>`;
  } else {
    const c = { ok: 0, revisar: 0, no: 0 }; I.items.forEach(x => c[x.status]++);
    const nsel = I.items.filter(x => x.sel && x.segs.length).length;
    h += `<div class="stats three"><div class="stat"><b>${c.ok}</b><span>Localizados</span></div><div class="stat warnc"><b>${c.revisar}</b><span>A revisar</span></div><div class="stat bad"><b>${c.no}</b><span>No localizados</span></div></div>
      <p class="mut small">Los marcados se importan <b>sin publicar</b>. «Ver» los muestra en el mapa; «Dibujar» permite trazar a mano los que no se localizaron o hay que corregir.</p>` +
      I.items.map((x, i) => `<div class="irow ${x.status}"><label class="chk"><input type="checkbox" data-sel="${i}" ${x.sel ? 'checked' : ''} ${x.segs.length ? '' : 'disabled'}></label>
        <div class="ib"><div class="t">${esc(x.corte.calle || '(sin calle)')} <span class="mut">· fila ${x.n}</span></div>
        <div class="s"><span class="badge ${x.status === 'ok' ? 'act' : x.status === 'revisar' ? 'prog' : 'bad'}">${{ ok: 'Localizado', revisar: 'Revisar', no: 'No localizado' }[x.status]}</span>${esc(x.corte.tramo)} · ${esc(x.corte.inicio.replace('T', ' '))}${x.corte.fin ? ' → ' + esc(x.corte.fin.replace('T', ' ')) : ''}</div>
        <div class="s">${esc(x.msg)}</div>
        <div class="mini">${x.segs.length ? `<button class="btn" data-act="imp-view" data-i="${i}">Ver</button>` : ''}<button class="btn" data-act="imp-draw" data-i="${i}">Dibujar</button></div></div></div>`).join('') +
      `<div class="btns"><button class="btn" data-act="imp-reset">Descartar</button><button class="btn pri" data-act="imp-go" ${nsel ? '' : 'disabled'}>Importar ${nsel} sin publicar</button></div>`;
  }
  body.innerHTML = h;
}

/* — Auditoría — */
const ROLN = { tic: 'Informática', mando: 'Mando', agente: 'Agente' };
const ACC = { CORTE_ALTA: ['Alta de corte', '#12b76a'], CORTE_EDICION: ['Modificación', '#1570ef'], CORTE_BORRADO: ['Borrado', '#d92d20'], CORTE_RESTAURADO: ['Restaurado', '#12b76a'],
  CORTE_PUBLICADO: ['Publicado', '#7a5af8'], CORTE_RETIRADO: ['Retirado de lo público', '#f79009'], IMPORTACION: ['Importación de archivo', '#c8a44d'], LOGIN: ['Acceso', '#98a2b3'],
  LOGIN_FALLIDO: ['Acceso fallido', '#d92d20'], LOGOUT: ['Salida', '#98a2b3'], USUARIO_ALTA: ['Usuario creado', '#c8a44d'], USUARIO_CAMBIO: ['Usuario modificado', '#c8a44d'],
  CLAVE_CAMBIO: ['Cambio de contraseña', '#98a2b3'], CLAVE_RESTABLECIDA: ['Contraseña restablecida', '#c8a44d'], COPIA_DESCARGADA: ['Copia descargada', '#98a2b3'] };
const FILTROS_ACC = [['', 'Toda la actividad'], ['CORTE', 'Cortes'], ['IMPORTACION', 'Importaciones'], ['LOGIN', 'Accesos'], ['USUARIO', 'Usuarios']];
async function viewLog() {
  const f = S.auditF || (S.auditF = { accion: '', q: '' });
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}<h2>Auditoría</h2>
    <p class="mut small">Registro de quién hizo qué y cuándo. No se puede borrar ni modificar desde la aplicación.</p>
    <div class="btns" style="margin-top:0">${store.can('auditoria.integridad') ? '<button class="btn" data-act="aud-verify">✔ Verificar integridad</button>' : ''}<button class="btn" data-act="aud-csv">⬇ Exportar CSV</button></div>
    <div id="audVerify"></div>
    <div class="filters"><input id="audq" class="search" type="search" placeholder="Buscar usuario, calle o detalle…" value="${esc(f.q)}" autocomplete="off">
      ${ddHTML('audacc', 'audacc', f.accion, FILTROS_ACC)}</div>
    <div id="audList"><p class="mut">Cargando…</p></div>`;
  await pintarAuditoria();
}
async function pintarAuditoria() {
  let log = null, msg = '';
  try { log = await store.loadAudit(S.auditF); } catch (e) { msg = e.message; }
  if (S.screen !== 'list' || S.tab !== 'log' || !$('#audList')) return;
  S.auditData = log || [];
  $('#audList').innerHTML = log === null ? `<p class="mut">No se pudo cargar: ${esc(msg)}</p>` : !log.length ? '<p class="empty">No hay actividad con ese filtro.</p>' : log.map(l => {
    const [lbl, col] = ACC[l.accion] || [l.accion, '#98a2b3'];
    return `<div class="item static"><span class="dot" style="background:${col}"></span><div class="ib"><div class="t">${esc(lbl)}${l.calle ? ' · ' + esc(l.calle) : ''}</div>
      <div class="s">${esc(new Date(l.fecha).toLocaleString('es-ES'))} · <b>${esc(l.usuario || '—')}</b>${l.rol ? ' (' + esc(ROLN[l.rol] || l.rol) + ')' : ''}${l.ip ? ' · ' + esc(l.ip) : ''}</div>
      ${l.detalle ? `<div class="s">${esc(l.detalle)}</div>` : ''}
      ${l.restaurable && store.can('auditoria.restaurar') ? `<div class="mini"><button class="btn" data-act="aud-restore" data-id="${esc(l.corte_id)}">Restaurar corte</button></div>` : ''}</div></div>`;
  }).join('');
}
function exportAuditCSV() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = (S.auditData || []).map(l => [new Date(l.fecha).toLocaleString('es-ES'), l.usuario, ROLN[l.rol] || l.rol, (ACC[l.accion] || [l.accion])[0], l.calle, l.detalle, l.ip].map(q).join(';'));
  download(`auditoria-cortes-${stamp()}.csv`, 'text/csv;charset=utf-8', '﻿' + ['fecha;usuario;perfil;accion;calle;detalle;ip', ...rows].join('\r\n'));
}

/* — Usuarios — */
async function viewUsers() {
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}<h2>Usuarios</h2><p class="mut">Cargando…</p>`;
  let list = null, msg = '';
  try { list = await store.listUsers(); } catch (e) { msg = e.message; }
  if (S.screen !== 'list' || S.tab !== 'users') return;
  const roles = store.can('usuarios.todos') ? ['agente', 'mando', 'tic'] : ['agente'];
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}<h2>Usuarios</h2>` + (list === null ? `<p class="mut">No se pudo cargar: ${esc(msg)}</p>` : list.map(u => `
    <div class="item static"><span class="dot" style="background:${u.activo ? '#12b76a' : '#98a2b3'}"></span><div class="ib">
      <div class="t">${esc(u.nombre)} <span class="mut">· ${esc(u.usuario)}</span></div>
      <div class="bs"><span class="badge ${u.activo ? 'act' : 'fin'}">${u.activo ? 'Activo' : 'Desactivado'}</span><span class="badge">${esc(u.rol_nombre)}</span>${u.cambiar_clave ? '<span class="badge prog">Debe cambiar la clave</span>' : ''}</div>
      <div class="s">Último acceso: ${u.ultimo_acceso ? esc(new Date(u.ultimo_acceso).toLocaleString('es-ES')) : 'nunca'}</div>
      <div class="mini"><button class="btn" data-act="usr-toggle" data-id="${u.id}" data-a="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button><button class="btn" data-act="usr-reset" data-id="${u.id}">Restablecer contraseña</button></div></div></div>`).join('')) +
    `<h3>Nuevo usuario</h3><form id="uf" autocomplete="off">
      <div class="two"><div><label>Usuario *</label><input name="usuario" required pattern="[A-Za-z0-9._\\-]{3,40}" autocapitalize="none" spellcheck="false"></div>
      <div><label>Perfil *</label>${ddHTML('rol', 'rol', 'agente', roles.map(r => [r, ROLN[r]]))}</div></div>
      <label>Nombre completo *</label><input name="nombre" required maxlength="100">
      <label>Contraseña temporal * (mín. 10, letras y números)</label><input name="clave" type="text" required minlength="10" autocomplete="off">
      <p class="mut small">Se le pedirá cambiarla en su primer acceso. Se recomienda una cuenta personal por agente para que la auditoría identifique a quien actúa.</p>
      <button class="btn pri wide">Crear usuario</button></form>`;
}

/* — Sistema (Informática) — */
async function viewSystem() {
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}<h2>Estado del sistema</h2><p class="mut">Cargando…</p>`;
  let s = null, msg = '';
  try { s = await store.system(); } catch (e) { msg = e.message; }
  if (S.screen !== 'list' || S.tab !== 'system') return;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  body.innerHTML = `${ribbonHTML()}${tabsHTML()}<h2>Estado del sistema</h2>` + (s === null ? `<p class="mut">No se pudo cargar: ${esc(msg)}</p>` : `
    ${s.integridad.ok ? `<div class="hint">✔ Auditoría íntegra (${s.integridad.total} registros).</div>` : `<div class="warn"><b>✘ La cadena de auditoría presenta alteraciones</b> (registro nº ${s.integridad.fallo_en}). Conservar una copia de la base de datos y avisar a la Jefatura.</div>`}
    ${s.https ? '' : '<div class="warn">La conexión no está marcada como HTTPS (COOKIE_SECURE=0). En producción debe servirse siempre por HTTPS.</div>'}
    <dl class="kv">${row('Versión', esc(s.version))}${row('Node.js', esc(s.node))}${row('Arranque', esc(new Date(s.arranque).toLocaleString('es-ES')))}${row('Zona horaria', esc(s.zona_horaria))}
    ${row('Usuarios', s.usuarios)}${row('Registros de auditoría', s.auditoria)}${row('Tamaño de la base de datos', (s.bd_bytes / 1024).toFixed(0) + ' KB')}</dl>
    <p class="mut small">Informática no puede ver ni modificar los cortes. Las copias de seguridad se hacen sobre el archivo de la base de datos (ver LEEME-INFORMATICA.md).</p>`);
}

/* ───────── Acciones ───────── */
function select(id, fit) { document.body.classList.remove('panel-off'); S.sel = id; renderMap(); showScreen('detail'); if (fit) { const c = S.cortes.find(x => x.id === id); if (c) fitCorte(c); } }
function cancelDraw() {
  const id = draft && draft.id; endDraw(); renderMap();
  if (id && S.cortes.some(c => c.id === id)) select(id); else { S.tab = draft && draft.fromImport ? 'import' : S.tab; showScreen('list'); }
}
async function guard(fn) { try { await fn(); } catch (e) { toast('Error: ' + e.message); if (/caducado|sesión/i.test(e.message)) { goLogin(); } } }

body.addEventListener('click', ev => {
  const t = ev.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, c = S.cortes.find(x => x.id === (t.dataset.id || S.sel)), I = S.imp;
  guard(async () => {
    switch (act) {
      case 'toggle': S.listOpen = !(S.listOpen === true); showScreen('list'); break;
      case 'when': S.when = t.dataset.w; S.sel = null; renderMap(); showScreen('list'); break;
      case 'tab': S.tab = t.dataset.t; showScreen('list'); break;
      case 'aud-verify': { const r = await store.verifyAudit(); $('#audVerify').innerHTML = r.ok ? `<div class="hint">✔ Cadena íntegra: ${r.total} registros sin alteraciones.<br><small>Sello del último registro: ${esc(r.ultimo_hash.slice(0, 20))}…</small></div>` : `<div class="warn"><b>✘ ALERTA:</b> el registro nº ${r.fallo_en} ha sido alterado o falta alguno anterior. Avisa a Informática y conserva una copia de la base de datos.</div>`; break; }
      case 'aud-csv': exportAuditCSV(); break;
      case 'aud-restore': if (confirm('¿Restaurar este corte? Volverá SIN publicar y quedará registrado.')) { await store.restore(t.dataset.id); toast('Corte restaurado (sin publicar)'); await reload(); renderMap(); await pintarAuditoria(); } break;
      case 'usr-toggle': await store.patchUser(+t.dataset.id, { activo: t.dataset.a === '1' }); showScreen('list'); break;
      case 'usr-reset': { const p = prompt('Contraseña temporal nueva (mín. 10 caracteres, con letras y números).\nEl usuario deberá cambiarla al entrar:'); if (p) { await store.patchUser(+t.dataset.id, { clave: p }); toast('Contraseña restablecida'); showScreen('list'); } break; }
      case 'new': startDraw(null); break;
      case 'open': select(t.dataset.id, true); break;
      case 'back': S.sel = null; renderMap(); showScreen('list'); break;
      case 'fit': if (c) fitCorte(c); break;
      case 'share': { const url = location.origin + location.pathname + '#/ciudadano'; if (navigator.share) navigator.share({ title: 'Cortes de calle · Don Benito', url }).catch(() => {}); else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } break; }
      case 'edit': draft = newDraft(c); draft.stage = 'form'; renderMap(); showScreen('form'); break;
      case 'redraw': startDraw(c); break;
      case 'dup': { const cp = JSON.parse(JSON.stringify(c)); cp.id = uid(); cp.calle += ' (copia)'; cp.publicado = false; delete cp.creado; delete cp.modificado; delete cp.creado_por; delete cp.modificado_por; await store.save(cp); await reload(); S.when = 'todos'; renderTop(); select(cp.id, false); toast('Duplicado (sin publicar)'); break; }
      case 'del': if (confirm(`¿Eliminar el corte «${c.calle}»? Quedará registrado en la auditoría y un mando podrá restaurarlo.`)) { await store.remove(c.id); S.sel = null; await reload(); renderMap(); showScreen('list'); toast('Corte eliminado'); } break;
      case 'pub': await store.save({ ...c, publicado: c.publicado === false }); await reload(); renderMap(); showScreen('detail'); toast(c.publicado === false ? 'Publicado para los ciudadanos' : 'Retirado de la vista pública'); break;
      case 'print': printReport(); break;
      case 'mode': draft.mode = t.dataset.m; if (draft.mode === 'libre') snapDot.remove(); showScreen('draw'); break;
      case 'undo': undoPoint(); break;
      case 'newseg': closeSegment(); renderDraft(); showScreen('draw'); break;
      case 'delseg': draft.segs.splice(+t.dataset.i, 1); renderDraft(); showScreen('draw'); break;
      case 'clear': draft.segs = []; draft.wps = []; draft.legs = []; renderDraft(); showScreen('draw'); break;
      case 'cancel': cancelDraw(); break;
      case 'next': closeSegment(); if (!draft.segs.length) return toast('Marca al menos dos puntos'); draft.stage = 'form'; snapDot.remove(); hideNetLayer(); map.getContainer().style.cursor = ''; renderDraft(); showScreen('form'); break;
      case 'backdraw': draft.stage = 'draw'; showNetLayer(); map.getContainer().style.cursor = 'crosshair'; renderDraft(); showScreen('draw'); break;
      /* importación */
      case 'imp-choose': $('#fileTabla').click(); break;
      case 'imp-template': download('plantilla-cortes.csv', 'text/csv;charset=utf-8', '\ufeff' + imp.TEMPLATE); break;
      case 'imp-reset': S.imp = null; draftLayer.clearLayers(); showScreen('list'); break;
      case 'imp-run': { I.items = imp.buildItems(I.table, I.map); showScreen('list'); break; }
      case 'imp-view': { const x = I.items[+t.dataset.i]; draftLayer.clearLayers(); x.segs.forEach(p => L.polyline(p, { color: '#1570ef', weight: 8, opacity: .9, interactive: false }).addTo(draftLayer)); map.fitBounds(L.latLngBounds(x.segs.flat()), { maxZoom: 18, padding: [30, 30] }); break; }
      case 'imp-draw': { const x = I.items[+t.dataset.i]; draftLayer.clearLayers(); startDraw({ ...x.corte, segs: x.segs.length ? x.segs : [] }, x); break; }
      case 'imp-go': {
        const list = I.items.filter(x => x.sel && x.segs.length).map(x => ({ id: uid(), ...x.corte, segs: x.segs.map(p => p.map(q => [+q[0].toFixed(6), +q[1].toFixed(6)])) }));
        await store.saveMany(list, { tipo: 'importacion', archivo: I.name, filas: I.items.length }); S.imp = null; draftLayer.clearLayers(); await reload(); S.tab = 'cortes'; S.when = 'todos'; renderTop(); renderMap(); showScreen('list');
        toast(`${list.length} cortes importados SIN publicar. Revísalos y publícalos uno a uno.`); break;
      }
    }
  });
});
body.addEventListener('click', ev => { if (ev.target.id === 'fechaSel') { try { ev.target.showPicker(); } catch { /* sin soporte: se abre al tocar */ } } });
body.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'q') { S.q = t.value; refreshItems(); renderMap(); }
  else if (t.id === 'audq') { clearTimeout(S.audT); S.audT = setTimeout(() => { S.auditF.q = t.value; pintarAuditoria(); }, 300); }
  else if (t.id === 'stq') { $('#stlist').innerHTML = searchStreets(t.value).map(n => `<option value="${esc(n)}">`).join(''); }
});
body.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'ftipo') { S.ftipo = t.value; refreshItems(); renderMap(); }
  else if (t.id === 'audacc') { S.auditF.accion = t.value; pintarAuditoria(); }
  else if (t.id === 'periodo') { S.when = t.value; if (S.when === 'fecha' && !S.fecha) S.fecha = fechaInput(new Date()); S.sel = null; renderMap(); showScreen('list'); if (S.when === 'fecha') setTimeout(() => { try { $('#fechaSel').showPicker(); } catch { /* el navegador lo abrirá al tocar */ } }, 0); }
  else if (t.id === 'fechaSel') { if (t.value) { S.when = 'fecha'; S.fecha = t.value; S.sel = null; renderMap(); showScreen('list'); } }
  else if (t.id === 'faut') { S.faut = t.value; refreshItems(); renderMap(); }
  else if (t.id === 'stq') { const b = streetBounds(t.value); if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 18 }); }
  else if (t.dataset.fmap) { S.imp.map[t.dataset.fmap] = t.value === '' ? undefined : +t.value; }
  else if (t.dataset.sel !== undefined) { S.imp.items[+t.dataset.sel].sel = t.checked; showScreen('list'); }
});
body.addEventListener('submit', ev => {
  if (ev.target.id !== 'uf') return; ev.preventDefault();
  const f = ev.target, b = f.querySelector('button'); b.disabled = true;
  guard(async () => { await store.createUser({ usuario: f.usuario.value.trim(), nombre: f.nombre.value.trim(), rol: f.rol.value, clave: f.clave.value }); toast('Usuario creado. Deberá cambiar la contraseña al entrar.'); showScreen('list'); }).finally(() => { b.disabled = false; });
});
document.addEventListener('keydown', ev => {
  if (!draft || /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
  if (ev.key === 'Escape') cancelDraw();
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && draft.stage === 'draw') { ev.preventDefault(); undoPoint(); }
});

/* ───────── Barra superior ───────── */
const topbar = $('#topbar');
function renderTop() {
  topbar.className = 'topbar ' + S.mode;
  if (S.mode === 'citizen') {
    topbar.innerHTML = `<div class="row1">${escudo('sh')}<div class="ttl"><b>Policía Local de Don Benito</b><span>Cortes de calle</span></div><button id="btnMenu" class="iconbtn" aria-label="Ajustes" title="Ajustes">${GEAR}</button></div>`;
  } else if (S.mode === 'agent') {
    topbar.innerHTML = `<div class="row1">${escudo('sh')}<div class="ttl"><b>Panel de cortes</b><span>Policía Local · ${esc(store.userName())}</span></div>
      <button id="btnPanel" class="iconbtn" aria-label="Mostrar u ocultar el panel" title="Mostrar u ocultar el panel"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button><button id="btnMenu" class="iconbtn" aria-label="Ajustes" title="Ajustes">${GEAR}</button></div>`;
  }
}
function refreshAll() {
  renderMap();
  if (S.screen === 'detail') viewDetail();
  else if (S.screen === 'list' && !(document.activeElement && ['q', 'ftipo', 'faut'].includes(document.activeElement.id)) && (S.mode === 'citizen' || S.tab === 'cortes')) showScreenKeepScroll();
}
function showScreenKeepScroll() { const y = body.scrollTop; showScreen('list'); body.scrollTop = y; }
document.addEventListener('click', ev => {
  if (ev.target.closest('#btnPanel')) { if (innerWidth >= 900) document.body.classList.toggle('panel-off'); else panel.classList.toggle('min'); return; }
  if (ev.target.closest('#btnMenu')) { openMenu(); return; }
  if (!menu.hidden && !menu.contains(ev.target)) menu.hidden = true;
});

/* ───────── Menú de ajustes ───────── */
const menu = $('#menu');
const ICON = {
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
const ic = k => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
function openMenu() {
  const base = ['base', baseKey === 'osm' ? 'Vista satélite' : 'Vista plano', 'layers'];
  const groups = S.mode === 'citizen'
    ? [[base, ['share', 'Compartir esta página', 'share']], [['agente', 'Acceso Policía Local', 'lock'], ['inicio', 'Inicio', 'home'], ['info', 'Acerca de', 'info']]]
    : [[base, ['ciud', 'Ver como ciudadano', 'eye']],
      ...(store.can('cortes.ver') ? [[['print', 'Parte para imprimir', 'printer'], ['csv', 'Exportar a Excel', 'download'], ['gj', 'Copia de seguridad', 'download'], ...(store.can('cortes.importar') ? [['imp', 'Importar copia', 'upload']] : [])]] : []),
      [...(store.can('cortes.ver') ? [['net', 'Actualizar callejero', 'refresh']] : []), ...(store.isRemote() && store.can('copia') ? [['copia', 'Copia completa del servidor', 'download']] : []), ...(store.isRemote() ? [['clave', 'Cambiar contraseña', 'key']] : [])].filter(Boolean),
      [store.isRemote() ? ['salir', 'Cerrar sesión', 'out', 'red'] : ['wipe', 'Borrar todos los cortes', 'trash', 'red'], ['inicio', 'Inicio', 'home'], ['info', 'Acerca de', 'info']]].filter(g => g.length);
  menu.innerHTML = groups.map(g => `<div class="mg">${g.map(([k, t, i, c]) => `<button data-m="${k}" class="${c || ''}">${ic(i)}<span>${t}</span></button>`).join('')}</div>`).join(''); menu.hidden = !menu.hidden;
}
menu.onclick = ev => {
  const b = ev.target.closest('[data-m]'); if (!b) return; const k = b.dataset.m; menu.hidden = true;

  guard(async () => {
    if (k === 'base') toggleBase();
    else if (k === 'share') { const url = location.origin + location.pathname + '#/ciudadano'; if (navigator.share) navigator.share({ title: 'Cortes de calle · Don Benito', url }).catch(() => {}); else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } }
    else if (k === 'agente') location.hash = '#/agente';
    else if (k === 'ciud') location.hash = '#/ciudadano';
    else if (k === 'inicio') location.hash = '';
    else if (k === 'gj') exportGeoJSON();
    else if (k === 'csv') exportCSV();
    else if (k === 'imp') $('#fileGeo').click();
    else if (k === 'print') printReport();
    else if (k === 'net') { await loadNet(true, setNetChip); toast(net.ready ? 'Callejero actualizado' : 'No se pudo descargar el callejero'); }
    else if (k === 'salir') { await store.logout(); location.hash = ''; }
    else if (k === 'clave') showPwChange(false);
    else if (k === 'copia') { download(`copia-cortes-${stamp()}.json`, 'application/json', JSON.stringify(await store.backup(), null, 1)); toast('Copia descargada (queda registrada en la auditoría)'); }
    else if (k === 'wipe') { if (S.cortes.length && confirm(`¿Borrar los ${S.cortes.length} cortes guardados en este dispositivo? No se puede deshacer.`)) { await store.removeAll(); await reload(); S.sel = null; renderMap(); showScreen('list'); } }
    else if (k === 'info') alert('Cortes de calle · Policía Local de Don Benito\n\nHerramienta de apoyo visual: no sustituye a la resolución, bando o decreto que ordene el corte.\n\nCartografía: © colaboradores de OpenStreetMap (ODbL) y PNOA © IGN.' + (store.isRemote() ? '' : '\n\nModo de pruebas: los datos se guardan solo en este dispositivo.'));
  });
};

/* ───────── Exportar / importar GeoJSON / parte ───────── */
function download(name, mime, text) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type: mime }));
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => toInput(new Date()).replace(/[-:T]/g, '').slice(0, 12);
function exportGeoJSON() {
  const fc = { type: 'FeatureCollection', features: S.cortes.map(c => { const { segs, ...props } = c; return { type: 'Feature', properties: props, geometry: { type: 'MultiLineString', coordinates: segs.map(p => p.map(([la, lo]) => [lo, la])) } }; }) };
  download(`cortes-don-benito-${stamp()}.geojson`, 'application/geo+json', JSON.stringify(fc, null, 1));
}
function exportCSV() {
  const cols = ['calle', 'tramo', 'tipo', 'motivo', 'solicita', 'autoriza', 'detalle_autorizacion', 'referencia', 'inicio', 'fin', 'estado', 'duracion', 'publicado', 'desvio', 'notas_internas', 'longitud_m', 'geometria_wkt'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = S.cortes.map(c => {
    const i = parse(c.inicio), f = parse(c.fin);
    const wkt = 'MULTILINESTRING(' + c.segs.map(p => '(' + p.map(([la, lo]) => `${lo} ${la}`).join(',') + ')').join(',') + ')';
    return [c.calle, c.tramo, (TIPOS[c.tipo] || {}).label, c.motivo, c.organismo, c.autoriza, c.autoriza_detalle, c.referencia, i ? i.toLocaleString('es-ES') : '', f ? f.toLocaleString('es-ES') : '', ESTADO_LBL[estado(c, new Date())], f ? span(f - i) : 'Sin fecha de fin', c.publicado === false ? 'No' : 'Sí', c.desvio, c.obs, Math.round(totalLen(c.segs)), wkt].map(q).join(';');
  });
  download(`cortes-don-benito-${stamp()}.csv`, 'text/csv;charset=utf-8', '\ufeff' + [cols.join(';'), ...rows].join('\r\n'));
}
$('#fileGeo').onchange = ev => guard(async () => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  const fc = JSON.parse(await file.text());
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('No es un archivo GeoJSON de cortes');
  const num = x => typeof x === 'number' && isFinite(x), dt = s => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s || '') ? s : '');
  const list = []; let skipped = 0;
  for (const f of fc.features) {
    const g = f.geometry || {}, lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null;
    const segs = lines && lines.map(l => (Array.isArray(l) ? l : []).filter(p => Array.isArray(p) && num(p[0]) && num(p[1])).map(([lo, la]) => [la, lo])).filter(l => l.length > 1);
    if (!segs || !segs.length) { skipped++; continue; }
    const p = f.properties || {};
    list.push({ id: isUuid(p.id) ? p.id : uid(), calle: String(p.calle || p.name || 'Sin nombre'), tramo: String(p.tramo || ''), tipo: TIPOS[p.tipo] ? p.tipo : 'total', motivo: String(p.motivo || 'Otro'),
      organismo: String(p.organismo || ''), autoriza: String(p.autoriza || ''), autoriza_detalle: String(p.autoriza_detalle || ''), referencia: String(p.referencia || ''),
      inicio: dt(p.inicio) || toInput(new Date()), fin: dt(p.fin), desvio: String(p.desvio || ''), obs: String(p.obs || ''), publicado: p.publicado !== false, origen: p.origen || 'manual', segs });
  }
  await store.saveMany(list, { tipo: 'importacion', archivo: file.name, filas: fc.features.length }); await reload(); S.when = 'todos'; renderTop(); renderMap(); showScreen('list');
  toast(`Importados ${list.length} cortes${skipped ? `, ${skipped} omitidos` : ''}`);
});
$('#fileTabla').onchange = ev => guard(async () => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  const table = await imp.readTable(file);
  S.imp = { table, name: file.name, map: imp.autoMap(table.headers), items: null }; S.tab = 'import'; showScreen('list');
});

const periodoTxt = () => ({ ahora: 'cortes vigentes en este momento', hoy: 'cortes de hoy', manana: 'cortes de mañana', fecha: 'cortes del ' + (S.fecha ? new Date(S.fecha + 'T00:00').toLocaleDateString('es-ES') : ''), todos: 'todos los cortes' }[S.when]);
function printReport() {
  const list = shown(), d = S.when === 'manana' ? addDays(S.view, 1) : (S.when === 'fecha' && S.fecha ? new Date(S.fecha + 'T12:00') : S.view);
  const fecha = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#report').innerHTML = `<div class="rhead">${escudo('rsh')}<div><h1>Policía Local de Don Benito</h1><h2>Parte de cortes de calle</h2><p>${esc(fecha)}, ${hora(d)} · ${esc(periodoTxt())}</p></div></div>
    <table><thead><tr><th>Calle / tramo</th><th>Afección</th><th>Desde</th><th>Hasta</th><th>Autoriza</th><th>Desvío</th></tr></thead><tbody>${list.map(c => {
      const i = parse(c.inicio), f = parse(c.fin);
      return `<tr><td><b>${esc(c.calle)}</b><br>${esc(c.tramo)}</td><td>${esc((TIPOS[c.tipo] || {}).label)}<br><small>${esc(c.motivo)}</small></td><td>${i ? i.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td><td>${f ? f.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'Sin fecha'}</td><td>${esc([c.autoriza, c.autoriza_detalle].filter(Boolean).join(' · '))}</td><td>${esc(c.desvio)}</td></tr>`;
    }).join('') || '<tr><td colspan="6">No hay cortes para el periodo seleccionado.</td></tr>'}</tbody></table><p class="rfoot">Generado el ${new Date().toLocaleString('es-ES')} · ${esc(store.userName())}</p>`;
  const L0 = list.length ? L.latLngBounds(list.flatMap(c => c.segs.flat())) : null; if (L0) map.fitBounds(L0, { padding: [20, 20], maxZoom: 17 });
  setTimeout(() => window.print(), 400);
}

/* ───────── Landing y acceso ───────── */
function renderLanding() {
  $('#landing').innerHTML = `<div class="lbox">${escudo('xl')}<h1>Policía Local<br>de Don Benito</h1><p class="sub">Cortes de calle y afecciones al tráfico</p>
    <div class="accs">
      <a class="acc" href="#/ciudadano"><i>👁</i><b>Ciudadanos</b><span>Consulta los cortes de calle vigentes y programados</span></a>
      <a class="acc alt" href="#/agente"><i>🔒</i><b>Policía Local</b><span>${store.isRemote() ? 'Acceso con usuario y contraseña' : 'Modo de pruebas (sin servidor)'}</span></a>
    </div><small>Información orientativa. Respete siempre la señalización y las indicaciones de los agentes.</small></div>`;
}
function goLogin() { location.hash = '#/agente'; showLogin(); }
function showLogin() {
  const m = $('#login'); m.hidden = false;
  m.innerHTML = `<div class="box"><button class="x" data-lg="close" aria-label="Cerrar">×</button>${escudo('sh lg')}<h2>Acceso Policía Local</h2><p class="mut">Introduce tus credenciales de agente.</p>
    <form id="lf"><label>Usuario</label><input name="usuario" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required><label>Contraseña</label><input name="pw" type="password" autocomplete="current-password" required>
    <div id="lerr" class="err" role="alert"></div><button class="btn pri wide">Entrar</button></form></div>`;
  $('#lf').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target, b = f.querySelector('button'); b.disabled = true; $('#lerr').textContent = '';
    try { const u = await store.login(f.usuario.value, f.pw.value); m.hidden = true; if (u.cambiar_clave) showPwChange(true); else await enter('agent'); }
    catch (e) { $('#lerr').textContent = e.message; b.disabled = false; }
  };
  m.querySelector('[data-lg=close]').onclick = () => { m.hidden = true; location.hash = ''; };
  setTimeout(() => m.querySelector('input').focus(), 50);
}

function showPwChange(forced) {
  const m = $('#login'); m.hidden = false;
  m.innerHTML = `<div class="box">${forced ? '' : '<button class="x" data-lg="close" aria-label="Cerrar">×</button>'}${escudo('sh lg')}<h2>${forced ? 'Elige una contraseña nueva' : 'Cambiar contraseña'}</h2><p class="mut">Mínimo 10 caracteres, con letras y números.</p>
    <form id="pf"><label>Contraseña actual</label><input name="actual" type="password" autocomplete="current-password" required><label>Contraseña nueva</label><input name="nueva" type="password" autocomplete="new-password" minlength="10" required>
    <label>Repite la nueva</label><input name="nueva2" type="password" autocomplete="new-password" required><div id="perr" class="err" role="alert"></div><button class="btn pri wide">Guardar</button></form></div>`;
  $('#pf').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target, b = f.querySelector('button'); $('#perr').textContent = '';
    if (f.nueva.value !== f.nueva2.value) { $('#perr').textContent = 'Las contraseñas nuevas no coinciden'; return; }
    b.disabled = true;
    try { await store.changePassword(f.actual.value, f.nueva.value); m.hidden = true; toast('Contraseña cambiada'); if (forced) await enter('agent'); }
    catch (e) { $('#perr').textContent = e.message; b.disabled = false; }
  };
  const x = m.querySelector('[data-lg=close]'); if (x) x.onclick = () => { m.hidden = true; };
  setTimeout(() => m.querySelector('input').focus(), 50);
}

/* ───────── Datos y navegación ───────── */
async function reload() {
  try {
    if (S.mode === 'citizen') { const r = await store.loadPublic(); S.cortes = r.list; S.stale = r.stale; }
    else if (store.can('cortes.ver')) { S.cortes = await store.loadAll(); S.stale = null; } else S.cortes = [];
  } catch (e) { toast('No se pudieron cargar los cortes: ' + e.message); if (/caducado|sesión/i.test(e.message)) goLogin(); }
}
const primeraPestana = () => (TABS.find(t => tabOK(t[2])) || TABS[0])[0];
async function enter(mode) {
  if (draft) endDraw();
  S.mode = mode; document.body.dataset.mode = mode; $('#landing').hidden = mode !== 'landing';
  if (mode === 'landing') { renderLanding(); renderMap(); return; }
  const cs = $('#ctop'); cs.hidden = mode !== 'citizen'; cs.innerHTML = '';
  if (mode === 'citizen') {
    cs.innerHTML = `<div class="cpill">${escudo('sh')}<div><b>Policía Local</b><span>Don Benito · Cortes de calle</span></div></div>
      <div class="csearch"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="cq" type="search" placeholder="¿Tu calle está cortada? Búscala aquí…" autocomplete="off" autocapitalize="none" aria-label="Buscar una calle"></div>
      <button id="btnMenu" class="cgear" aria-label="Ajustes" title="Ajustes">${GEAR}</button>`;
    $('#cq').oninput = ev => { clearTimeout(S.cqT); S.cqT = setTimeout(() => { S.q = ev.target.value.trim(); S.sel = null; renderMap(); showScreen('list'); const l = S.cortes.filter(c => estado(c, S.view) !== 'fin' && matchesFilters(c)); if (S.q && l.length) encuadrar(l.flatMap(c => c.segs.flat()), 17); }, 200); };
  }
  $('#pshow').hidden = mode !== 'agent'; document.body.classList.remove('panel-off');
  S.sel = null; S.screen = 'list'; S.tab = mode === 'agent' ? primeraPestana() : 'cortes'; S.q = S.ftipo = S.faut = ''; S.view = new Date(); S.when = 'ahora'; S.fecha = null; S.listOpen = null; S.imp = null;
  renderTop(); await reload();
  if (mode === 'agent' && store.can('cortes.crear')) loadNet(false, setNetChip);
  renderMap(); showScreen('list'); setTimeout(() => map.invalidateSize(), 50);
}
function router() {
  const h = location.hash;
  if (h.startsWith('#/ciudadano')) { $('#login').hidden = true; return enter('citizen'); }
  if (h.startsWith('#/agente')) { if (!store.loggedIn()) { enter('landing'); showLogin(); return; } if (store.isRemote() && store.user().cambiar_clave) { enter('landing'); showPwChange(true); return; } $('#login').hidden = true; return enter('agent'); }
  $('#login').hidden = true; enter('landing');
}
window.addEventListener('hashchange', router);
setInterval(() => {
  if (S.mode !== 'citizen' && S.mode !== 'agent') return;
  if (draft || S.screen === 'form' || S.screen === 'draw') return;
  guard(async () => { await reload(); S.view = new Date(); refreshAll(); });
}, 60000);

/* ───────── Arranque ───────── */
(async () => {
  await store.init();
  router();
  window.__appListo = true;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
window.__cortes = { S, net, snap, route, map, store };
