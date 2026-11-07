/* Configuración del servidor (opcional).
 *
 * Sin rellenar  → MODO DE PRUEBAS: los cortes se guardan solo en cada dispositivo.
 * Rellenado     → los agentes inician sesión y todos los cortes se comparten con el servidor;
 *                 los ciudadanos ven únicamente los cortes publicados.
 *
 * Instrucciones paso a paso: servidor/LEEME.md
 * La "clave pública" (anon) está pensada para ir en el navegador; la seguridad la dan
 * las reglas de la base de datos (servidor/supabase.sql). NUNCA pegues aquí la clave "service_role".
 */
window.CORTES_CONFIG = {
  supabaseUrl: '',   // ej.: 'https://xxxxxxxx.supabase.co'
  supabaseKey: '',   // clave pública «anon» del proyecto
};
