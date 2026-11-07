/* Base de datos, contraseñas, auditoría y permisos del servidor de cortes de calle. */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '1.0.0';
export const ROLES = ['tic', 'mando', 'agente'];
export const ROL_NOMBRE = { tic: 'Informática', mando: 'Mando', agente: 'Agente' };

/* ÚNICO sitio donde se definen los permisos. Para cambiar quién puede qué, editar aquí. */
export const PERMS = {
  tic:    ['usuarios.todos', 'sistema', 'auditoria.integridad'],
  mando:  ['cortes.ver', 'cortes.crear', 'cortes.editar', 'cortes.publicar', 'cortes.borrar', 'cortes.importar',
           'auditoria.ver', 'auditoria.integridad', 'auditoria.restaurar', 'usuarios.agentes', 'copia'],
  agente: ['cortes.ver', 'cortes.crear', 'cortes.editar', 'cortes.publicar', 'cortes.borrar', 'cortes.importar'],
};
export const can = (rol, p) => (PERMS[rol] || []).includes(p);

export function abrirBD(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    create table if not exists usuarios (
      id integer primary key autoincrement,
      usuario text not null unique collate nocase,
      nombre text not null,
      rol text not null check (rol in ('tic','mando','agente')),
      salt text not null, hash text not null,
      activo integer not null default 1,
      cambiar_clave integer not null default 1,
      creado text not null, ultimo_acceso text,
      intentos integer not null default 0, bloqueado_hasta text
    );
    create table if not exists sesiones (
      token_hash text primary key,
      usuario_id integer not null references usuarios(id),
      creada text not null, expira text not null, ultima text not null, ip text
    );
    create table if not exists cortes (
      id text primary key,
      datos text not null,
      publicado integer not null default 0,
      eliminado integer not null default 0,
      creado text not null, creado_por text,
      modificado text not null, modificado_por text
    );
    create table if not exists auditoria (
      id integer primary key autoincrement,
      fecha text not null, usuario text, rol text, accion text not null,
      corte_id text, calle text, detalle text, datos text, ip text,
      prev_hash text not null, hash text not null
    );
    create index if not exists auditoria_fecha on auditoria(fecha);
  `);
  return db;
}

/* ───────── Contraseñas ───────── */
export function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(clave, salt, 64).toString('hex') };
}
export function verificarClave(clave, salt, hash) {
  const h = crypto.scryptSync(clave, salt, 64), b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}
export function validarClave(clave, usuario) {
  if (typeof clave !== 'string' || clave.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (clave.length > 200) return 'La contraseña es demasiado larga';
  if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) return 'La contraseña debe combinar letras y números';
  if (usuario && clave.toLowerCase().includes(String(usuario).toLowerCase())) return 'La contraseña no puede contener el nombre de usuario';
  return null;
}
export const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* ───────── Auditoría encadenada ───────── */
const filaHash = (prev, r) => sha(prev + '|' + [r.fecha, r.usuario || '', r.rol || '', r.accion, r.corte_id || '', r.calle || '', r.detalle || '', r.datos || '', r.ip || ''].join('|'));
export function auditar(db, ctx, accion, { corte_id = null, calle = null, detalle = null, datos = null } = {}) {
  const p = db.prepare('select hash from auditoria order by id desc limit 1').get(), prev = p ? p.hash : '';
  const r = { fecha: new Date().toISOString(), usuario: ctx.usuario || null, rol: ctx.rol || null, accion, corte_id, calle,
    detalle: detalle ? String(detalle).slice(0, 600) : null, datos: datos == null ? null : JSON.stringify(datos), ip: ctx.ip || null };
  db.prepare('insert into auditoria(fecha,usuario,rol,accion,corte_id,calle,detalle,datos,ip,prev_hash,hash) values(?,?,?,?,?,?,?,?,?,?,?)')
    .run(r.fecha, r.usuario, r.rol, r.accion, r.corte_id, r.calle, r.detalle, r.datos, r.ip, prev, filaHash(prev, r));
}
export function verificarAuditoria(db) {
  let prev = '', n = 0;
  for (const r of db.prepare('select * from auditoria order by id').all()) {
    if (r.prev_hash !== prev || r.hash !== filaHash(prev, r)) return { ok: false, total: n, fallo_en: r.id };
    prev = r.hash; n++;
  }
  return { ok: true, total: n, ultimo_hash: prev };
}

/* ───────── Validación de cortes ───────── */
const TIPOS = ['total', 'parcial', 'sentido', 'estac'];
const FECHA = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const err = (status, message) => Object.assign(new Error(message), { status });
export function limpiarCorte(c) {
  if (!c || typeof c !== 'object') throw err(400, 'Corte no válido');
  const txt = (k, max, req) => {
    let v = c[k] == null ? '' : c[k];
    if (typeof v !== 'string') throw err(400, `Campo «${k}» no válido`);
    v = v.trim(); if (v.length > max) throw err(400, `Campo «${k}» demasiado largo (máx. ${max})`);
    if (req && !v) throw err(400, `Falta el campo «${k}»`); return v;
  };
  if (!UUID.test(String(c.id))) throw err(400, 'Identificador no válido');
  const o = { calle: txt('calle', 200, true), tramo: txt('tramo', 200), tipo: c.tipo, motivo: txt('motivo', 100), organismo: txt('organismo', 100),
    autoriza: txt('autoriza', 100), autoriza_detalle: txt('autoriza_detalle', 200), lado: ['pares', 'impares', 'ambos'].includes(c.lado) ? c.lado : '', referencia: txt('referencia', 100), firma: txt('firma', 60),
    inicio: c.inicio, fin: c.fin || '', desvio: txt('desvio', 1000), obs: txt('obs', 2000), origen: c.origen === 'importado' ? 'importado' : 'manual' };
  if (!TIPOS.includes(o.tipo)) throw err(400, 'Tipo de afección no válido');
  if (!FECHA.test(o.inicio || '')) throw err(400, 'Fecha de inicio no válida');
  if (o.fin && !FECHA.test(o.fin)) throw err(400, 'Fecha de fin no válida');
  if (o.fin && o.fin < o.inicio) throw err(400, 'La fecha de fin es anterior a la de inicio');
  const publicado = c.publicado === true;
  if (publicado && !o.autoriza) throw err(400, 'Para publicar un corte hay que indicar quién lo autoriza');
  if (!Array.isArray(c.segs) || !c.segs.length || c.segs.length > 50) throw err(400, 'Trazado no válido');
  let pts = 0;
  o.segs = c.segs.map(s => {
    if (!Array.isArray(s) || s.length < 2 || s.length > 5000) throw err(400, 'Trazado no válido');
    pts += s.length; if (pts > 20000) throw err(400, 'Trazado demasiado grande');
    return s.map(p => {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !(Math.abs(p[0]) <= 90) || !(Math.abs(p[1]) <= 180)) throw err(400, 'Coordenadas no válidas');
      return [+p[0].toFixed(6), +p[1].toFixed(6)];
    });
  });
  return { id: c.id, publicado, datos: o };
}
export const CAMPOS_DIFF = ['calle', 'tramo', 'tipo', 'lado', 'motivo', 'organismo', 'autoriza', 'autoriza_detalle', 'referencia', 'inicio', 'fin', 'desvio', 'obs', 'firma'];
export function diferencias(antes, despues) {
  const d = [];
  for (const k of CAMPOS_DIFF) if ((antes[k] || '') !== (despues[k] || '')) d.push(`${k}: «${String(antes[k] || '').slice(0, 40)}» → «${String(despues[k] || '').slice(0, 40)}»`);
  if (JSON.stringify(antes.segs) !== JSON.stringify(despues.segs)) d.push('trazado modificado');
  return d.join(' · ');
}
export const resumenCorte = datos => { const { segs, ...r } = datos; return { ...r, segs_puntos: (segs || []).reduce((a, s) => a + s.length, 0) }; };
