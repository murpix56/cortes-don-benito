# Conectar el servidor (agentes con usuario + vista pública para ciudadanos)

Sin esto la aplicación funciona en **modo de pruebas**: cada dispositivo guarda sus propios cortes y no hay separación real entre agentes y ciudadanos (un «acceso» sin servidor no protege nada). Con el servidor:

- Los **agentes** inician sesión con correo y contraseña; todos ven y editan los mismos cortes.
- Los **ciudadanos** ven solo los cortes **publicados**, sin notas internas ni expedientes.
- Cada alta, cambio o borrado queda en el historial (actividad), con el usuario y la hora.

Se usa [Supabase](https://supabase.com) (PostgreSQL + autenticación). Tiene un plan gratuito suficiente para este uso.

## Pasos (≈15 minutos)

1. **Crear el proyecto** en supabase.com → *New project*. Elige región **EU (Frankfurt)**. Guarda la contraseña de la base de datos.
2. **Crear las tablas y permisos:** menú *SQL Editor* → *New query* → pega todo el contenido de `servidor/supabase.sql` → *Run*.
3. **Cerrar el registro público:** *Authentication → Sign In / Providers → Email* → desactiva **Allow new users to sign up** (y deja *Confirm email* según prefieras). Así solo entran los usuarios que crees tú.
4. **Crear los usuarios de los agentes:** *Authentication → Users → Add user → Create new user* (correo + contraseña). Marca *Auto Confirm User*.
5. **Copiar los datos de conexión:** *Project Settings → API*:
   - **Project URL** → `supabaseUrl`
   - clave **anon / public** → `supabaseKey`

   Pégalos en `config.js` y sube el cambio a GitHub. **No uses nunca la clave `service_role`.**
6. Abre la aplicación → *Policía Local* → entra con uno de los usuarios.

## Enlaces para compartir

- Ciudadanos (solo lectura): `https://murpix56.github.io/cortes-don-benito/#/ciudadano` (se puede convertir en código QR).
- Agentes: `https://murpix56.github.io/cortes-don-benito/#/agente`.

## Notas

- Todos los usuarios registrados tienen el mismo perfil de agente (ver, crear, editar, borrar). Si se necesitan perfiles distintos (solo consulta, administrador), hay que ampliar las reglas del `supabase.sql`.
- Los cortes se publican con el interruptor «Visible para los ciudadanos». Los importados desde Excel quedan **sin publicar** hasta que se revisan.
- Los cortes finalizados dejan de mostrarse al público 2 días después de su fin.
- **Protección de datos:** el sistema no almacena datos personales de ciudadanos; sí el correo de los agentes. Conviene comentar el alojamiento (UE) y las medidas de seguridad con el servicio de informática del Ayuntamiento / delegado de protección de datos antes de uso operativo.
- Copia de seguridad: menú ⋯ → *Exportar GeoJSON*.
