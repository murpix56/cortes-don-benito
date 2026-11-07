/* Callejero (OpenStreetMap vía Overpass), grafo, ajuste a calle, rutas y localización de tramos por nombre */
import { lsGet, lsSet, normName, lengthM } from './util.js?v=20261108c';

export const CFG = {
  center: [38.9565, -5.8612], zoom: 15,
  bbox: [38.936, -5.884, 38.976, -5.838],      // S, O, N, E (casco urbano Don Benito–Villanueva)
  snapMax: 70,
};
const NET_KEY = 'cortes.callejero.v1';
const KY = 111320, KX = 111320 * Math.cos(CFG.center[0] * Math.PI / 180);
const xy = (lat, lon) => [(lon - CFG.center[1]) * KX, (lat - CFG.center[0]) * KY];

export const net = { ready: false, adj: [], X: [], Y: [], lat: [], lon: [], ea: [], eb: [], el: [], en: [], names: [], lines: [], nways: 0, _ni: null, _ne: null };

export function buildNet(ways) {
  Object.assign(net, { ready: false, adj: [], X: [], Y: [], lat: [], lon: [], ea: [], eb: [], el: [], en: [], names: [], lines: [], nways: ways.length, _ni: null, _ne: null });
  const idx = new Map(), nameIdx = new Map();
  const nm = s => { s = s || ''; if (!nameIdx.has(s)) { nameIdx.set(s, net.names.length); net.names.push(s); } return nameIdx.get(s); };
  const node = (id, lat, lon) => {
    let k = idx.get(id);
    if (k === undefined) { k = net.lat.length; idx.set(id, k); net.lat.push(lat); net.lon.push(lon); const [x, y] = xy(lat, lon); net.X.push(x); net.Y.push(y); net.adj.push([]); }
    return k;
  };
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
      net.ea.push(a); net.eb.push(b); net.el.push(len); net.en.push(ni);
      net.adj[a].push([b, len, ni]); net.adj[b].push([a, len, ni]);
    }
    net.lines.push(line);
  }
  net.ready = net.ea.length > 0;
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
      const j = await r.json(), ways = [];
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

let loading = null;
/* Carga el callejero (caché local o descarga). status(texto, clase) informa del estado. */
export function loadNet(force, status = () => {}) {
  if (loading && !force) return loading;
  loading = (async () => {
    if (!force) {
      try { const c = JSON.parse(lsGet(NET_KEY, 'null')); if (c && c.ways && c.ways.length) { buildNet(c.ways); status(`Callejero: ${c.ways.length} vías`, 'ok'); return true; } } catch { /* caché corrupta */ }
    }
    status('Callejero: descargando…', '');
    try {
      const ways = await fetchOverpass();
      buildNet(ways); lsSet(NET_KEY, JSON.stringify({ t: Date.now(), ways }));
      status(`Callejero: ${ways.length} vías`, 'ok'); return true;
    } catch (err) {
      console.warn(err); status('Sin callejero · trazado libre', 'bad'); return false;
    } finally { loading = null; }
  })();
  return loading;
}

/* Punto más cercano sobre una calle */
export function snap(lat, lon, maxM) {
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
export function snapNode(k) {
  if (!net._ne) { net._ne = new Map(); for (let e = 0; e < net.ea.length; e++) { if (!net._ne.has(net.ea[e])) net._ne.set(net.ea[e], [e, 0]); if (!net._ne.has(net.eb[e])) net._ne.set(net.eb[e], [e, 1]); } }
  const r = net._ne.get(k); if (!r) return null;
  return { e: r[0], t: r[1], lat: net.lat[k], lon: net.lon[k] };
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(d, v) { const a = this.a; a.push([d, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}

/* Ruta más corta por calles. opts.prefer: conjunto de nombres de vía preferidos (las demás cuestan el triple). */
export function route(s1, s2, opts = {}) {
  const pref = opts.prefer, L1 = net.el[s1.e], L2 = net.el[s2.e];
  if (s1.e === s2.e) return { path: [[s1.lat, s1.lon], [s2.lat, s2.lon]], names: [{ name: net.names[net.en[s1.e]], len: Math.abs(s1.t - s2.t) * L1 }] };
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
      const nd = d + (pref && !pref.has(nm) ? w * 3 : w);
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
  return { path: [[s1.lat, s1.lon], ...nodes.map(k => [net.lat[k], net.lon[k]]), [s2.lat, s2.lon]], names };
}

/* ───────── Búsqueda y localización por nombre ───────── */
function normIndex() {
  if (net._ni) return net._ni;
  const m = new Map();
  net.names.forEach((n, i) => { const k = normName(n); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return (net._ni = m);
}
export function matchNames(q) {
  const k = normName(q); if (!k || !net.ready) return [];
  const idx = normIndex();
  if (idx.has(k)) return idx.get(k);
  const out = [];
  for (const [kk, arr] of idx) if (kk.includes(k) || k.includes(kk)) out.push(...arr);
  return out;
}
export function searchStreets(q) {
  const k = normName(q); if (!k || !net.ready) return [];
  const seen = new Set(), out = [];
  for (const n of net.names) { if (!n || seen.has(n)) continue; if (normName(n).includes(k)) { seen.add(n); out.push(n); } }
  return out.sort((a, b) => a.localeCompare(b, 'es')).slice(0, 8);
}
export function streetBounds(name) {
  let s = 90, w = 180, n = -90, e = -180;
  net.names.forEach((nm, i) => { if (nm !== name) return; for (let k = 0; k < net.ea.length; k++) if (net.en[k] === i) for (const v of [net.ea[k], net.eb[k]]) { s = Math.min(s, net.lat[v]); n = Math.max(n, net.lat[v]); w = Math.min(w, net.lon[v]); e = Math.max(e, net.lon[v]); } });
  return n < s ? null : [[s, w], [n, e]];
}
const nodesOf = set => { const out = new Set(); for (let e = 0; e < net.ea.length; e++) if (set.has(net.en[e])) { out.add(net.ea[e]); out.add(net.eb[e]); } return out; };

function streetSegments(set) {
  const edges = []; for (let e = 0; e < net.ea.length; e++) if (set.has(net.en[e])) edges.push(e);
  const byNode = new Map(), add = (k, e) => { if (!byNode.has(k)) byNode.set(k, []); byNode.get(k).push(e); };
  edges.forEach(e => { add(net.ea[e], e); add(net.eb[e], e); });
  const used = new Set(), segs = [];
  for (const e0 of edges) {
    if (used.has(e0)) continue; used.add(e0);
    const chain = [net.ea[e0], net.eb[e0]];
    for (const fwd of [true, false]) {
      for (;;) {
        const end = fwd ? chain[chain.length - 1] : chain[0];
        const cand = (byNode.get(end) || []).filter(x => !used.has(x));
        if (cand.length !== 1) break;
        const e = cand[0]; used.add(e);
        const other = net.ea[e] === end ? net.eb[e] : net.ea[e];
        if (fwd) chain.push(other); else chain.unshift(other);
      }
    }
    segs.push(chain.map(k => [net.lat[k], net.lon[k]]));
  }
  return segs;
}

/* Localiza un tramo: calle entre dos calles de cruce. Devuelve {status: 'ok'|'revisar'|'no', segs, msg} */
export function locateTramo(calle, desde, hasta) {
  if (!net.ready) return { status: 'no', segs: [], msg: 'Callejero no disponible' };
  const A = matchNames(calle);
  if (!A.length) return { status: 'no', segs: [], msg: 'Calle no encontrada en el callejero' };
  const setA = new Set(A), nodesA = nodesOf(setA);
  const cross = q => { const m = matchNames(q); if (!m.length) return []; return [...nodesOf(new Set(m))].filter(k => nodesA.has(k)); };
  if (desde && hasta) {
    const cd = cross(desde), ch = cross(hasta);
    if (cd.length && ch.length) {
      let best = null;
      for (const a of cd.slice(0, 6)) for (const b of ch.slice(0, 6)) {
        if (a === b) continue;
        const sa = snapNode(a), sb = snapNode(b); if (!sa || !sb) continue;
        const r = route(sa, sb, { prefer: setA });
        if (r) { const len = lengthM(r.path); if (!best || len < best.len) best = { r, len }; }
      }
      if (best) return { status: 'ok', segs: [best.r.path], msg: `${Math.round(best.len)} m entre «${desde}» y «${hasta}»` };
    }
    return { status: 'revisar', segs: streetSegments(setA), msg: 'No se pudo situar el tramo entre esas calles; se marca la calle completa' };
  }
  return { status: 'revisar', segs: streetSegments(setA), msg: 'Sin tramo (desde/hasta): se marca la calle completa' };
}

/* Nombre de la calle que cruza en el extremo de un corte (para proponer «Entre A y B») */
export function crossNames(lat, lon) {
  const s = snap(lat, lon, 60); if (!s) return '';
  const propia = net.names[net.en[s.e]], k = s.t < 0.5 ? net.ea[s.e] : net.eb[s.e], cnt = new Map();
  for (const [, , nm] of net.adj[k]) { const n = net.names[nm]; if (n && n !== propia) cnt.set(n, (cnt.get(n) || 0) + 1); }
  return [...cnt.keys()][0] || '';
}
