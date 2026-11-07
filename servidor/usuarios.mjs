/* Gestión de usuarios desde la línea de comandos (para crear el primer usuario y recuperar accesos).
 *   node servidor/usuarios.mjs crear <usuario> <tic|mando|agente> "<Nombre completo>"
 *   node servidor/usuarios.mjs listar
 *   node servidor/usuarios.mjs restablecer <usuario>
 *   node servidor/usuarios.mjs activar|desactivar <usuario>
 * La contraseña se pide por teclado (no se muestra). Quedará marcada para cambiarla en el primer acceso. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBD, hashClave, validarClave, auditar, ROLES } from './lib.mjs';
const db = abrirBD(process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos', 'cortes.db'));
const ctx = { usuario: 'CLI (servidor)', rol: null, ip: 'local' };
function pedir(txt) {
  if (process.env.CORTES_CLAVE) return Promise.resolve(process.env.CORTES_CLAVE);   // solo para pruebas automáticas
  return new Promise(ok => {
    process.stdout.write(txt); const si = process.stdin; si.setRawMode?.(true); si.resume(); si.setEncoding('utf8'); let s = '';
    const on = ch => { for (const c of ch) { if (c === '\r' || c === '\n' || c === '\u0004') { si.setRawMode?.(false); si.pause(); si.off('data', on); process.stdout.write('\n'); return ok(s); } if (c === '\u0003') process.exit(130); s = (c === '\u007f' || c === '\b') ? s.slice(0, -1) : s + c; } };
    si.on('data', on);
  });
}
const [cmd, usuario, a, b] = process.argv.slice(2);
const fin = m => { console.log(m); process.exit(0); };
const falla = m => { console.error('Error: ' + m); process.exit(1); };
if (cmd === 'listar') { for (const u of db.prepare('select * from usuarios order by usuario').all()) console.log(`${u.usuario.padEnd(20)} ${u.rol.padEnd(7)} ${u.activo ? 'activo   ' : 'DESACTIVADO'} ${u.nombre}`); process.exit(0); }
if (!usuario) falla('Falta el nombre de usuario. Ver cabecera de este archivo.');
const u = db.prepare('select * from usuarios where usuario = ?').get(usuario);
if (cmd === 'crear') {
  if (u) falla('Ya existe ese usuario'); if (!ROLES.includes(a)) falla('Perfil: ' + ROLES.join(' | ')); if (!/^[A-Za-z0-9._-]{3,40}$/.test(usuario)) falla('Usuario: 3-40 caracteres (letras, números, . _ -)');
  const c1 = await pedir('Contraseña: '), e = validarClave(c1, usuario); if (e) falla(e);
  if (!process.env.CORTES_CLAVE && (await pedir('Repite la contraseña: ')) !== c1) falla('Las contraseñas no coinciden');
  const { salt, hash } = hashClave(c1);
  db.prepare('insert into usuarios(usuario,nombre,rol,salt,hash,activo,cambiar_clave,creado) values(?,?,?,?,?,1,1,?)').run(usuario, b || usuario, a, salt, hash, new Date().toISOString());
  auditar(db, ctx, 'USUARIO_ALTA', { detalle: `${usuario} (${a})` }); fin(`Usuario «${usuario}» creado. Deberá cambiar la contraseña en su primer acceso.`);
}
if (!u) falla('No existe ese usuario');
if (cmd === 'restablecer') {
  const c1 = await pedir('Nueva contraseña temporal: '), e = validarClave(c1, usuario); if (e) falla(e);
  const { salt, hash } = hashClave(c1);
  db.prepare('update usuarios set salt=?, hash=?, cambiar_clave=1, intentos=0, bloqueado_hasta=null, activo=1 where id=?').run(salt, hash, u.id); db.prepare('delete from sesiones where usuario_id=?').run(u.id);
  auditar(db, ctx, 'CLAVE_RESTABLECIDA', { detalle: usuario }); fin('Contraseña restablecida; se pedirá cambiarla en el próximo acceso.');
}
if (cmd === 'activar' || cmd === 'desactivar') {
  db.prepare('update usuarios set activo=? where id=?').run(cmd === 'activar' ? 1 : 0, u.id); if (cmd === 'desactivar') db.prepare('delete from sesiones where usuario_id=?').run(u.id);
  auditar(db, ctx, 'USUARIO_CAMBIO', { detalle: `${usuario}: ${cmd}do` }); fin('Hecho.');
}
falla('Orden no reconocida');
