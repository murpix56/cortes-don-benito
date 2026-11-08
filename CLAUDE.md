# Cortes de calle · Policía Local de Don Benito

Aplicación web **estática** (sin build) para mostrar los cortes de calle de Don Benito: vista pública para ciudadanos y panel de gestión para la Policía Local. Publicada con GitHub Pages desde `main` (raíz): https://murpix56.github.io/cortes-don-benito/ . Repositorio hermano e independiente: `disenador-planos` (herramienta personal para hacer planos de redes sociales; no mezclar).

## Cómo trabajar con el usuario
- Es subinspector de la Policía Local de Don Benito; el rol es de planificación y coordinación. Responder **en español**, tono técnico pero cercano, con rigor.
- Cuando se cite normativa, verificar texto y vigencia antes de citar (hay una skill `verificacion-normativa`). Si no se puede verificar, decirlo.
- El usuario describe el diseño a ojo y pide ajustes finos: ver siempre una captura real antes de dar por buena una pantalla. Prefiere interfaces limpias y mínimas, con la información **en vertical** (un dato por línea), sin etiquetas de sobra.
- Programa de gestión que usan: **VinfoPol** (así se escribe). La importación de Excel/CSV está hecha de forma genérica; **aún no se ha probado con un archivo real de VinfoPol**.

## Estado (resumen)
- Dos vistas: `#/ciudadano` (tarjeta flotante sobre el mapa, recogida al entrar, buscador «¿Tu calle está cortada?», sección «Prohibido estacionar» y «Próximamente», sin leyenda) y `#/agente` (panel lateral: pestañas Cortes / Importar / Auditoría; Usuarios y Sistema solo con servidor).
- Modelo de un corte (localStorage `cortes.v1`, array): `id, calle, tramo, tipo ('total'|'parcial'|'estac'), lado ('pares'|'impares'|'ambos'|''), motivo, autoriza ('Ayuntamiento'|'Policía Local'), autoriza_detalle, referencia, firma, obs, inicio, fin ('YYYY-MM-DDTHH:mm' local; fin vacío = sin fecha de fin), desvio, publicado, origen ('manual'|'importado'), segs ([[ [lat,lon]… ]…]), creado, modificado`.
  - «Un solo carril» (`parcial`) exige `lado` pares/impares. «Prohibido estacionar» (`estac`) lleva lado, por defecto «ambos». «Sentido único» se eliminó a petición del usuario.
- Trazado: el usuario marca puntos y la ruta sigue las calles (callejero de OpenStreetMap vía Overpass, grafo + Dijkstra en `js/net.js`; «Libre» como alternativa). Propone «Entre A y B» con las calles de los extremos. Se eliminan los «rebotes» al marcar un punto pasado el cruce.
- Importar `.xlsx`/`.csv`: lector propio sin dependencias (`js/importer.js`), correspondencia de columnas y localización por calle y cruces «desde/hasta»; lo importado entra **sin publicar**.
- Auditoría (en modo local, simple) y parte imprimible. Exportación a CSV/GeoJSON.
- Plano de fondo: OSM o satélite PNOA (IGN). Atribución de OpenStreetMap arriba a la izquierda (debe verse siempre: licencia).

## Arquitectura
`index.html`, `style.css`, `config.js`, `boot.js`, `sw.js`, `js/{app,store,net,importer,util}.js` (módulos ES), `vendor/leaflet`. `servidor/` (opcional, aparcado), `Dockerfile`, `pruebas/`.
- `js/store.js` detecta solo el modo: si responde `api/estado` usa el **servidor** propio; si no (GitHub Pages) funciona en **modo local** (datos en el navegador, sin usuarios: actúa como «mando»).
- Desplegable propio (`ddHTML`) para todos los selectores; icono de ajustes y menú minimalista.

## Servidor opcional (APARCADO por decisión del usuario)
`servidor/` = Node.js ≥ 22.13 + SQLite (`node:sqlite`), sin dependencias. Perfiles `tic` (Informática: usuarios y estado, no toca cortes), `mando` (todo + auditoría + restaurar + usuarios agentes) y `agente` (crear, importar, editar, publicar, borrar). Auditoría encadenada con hash (detecta manipulación), contraseñas con scrypt, sesiones por cookie, bloqueo por intentos. `node servidor/pruebas.mjs` → 72 comprobaciones. La idea del usuario: **el Ayuntamiento (informáticos) lo alojará en su dominio** cuando todo esté terminado. **Falta escribir** `servidor/LEEME-INFORMATICA.md` (requisitos, instalación, proxy inverso HTTPS, copias de seguridad, perfiles). De la normativa de seguridad solo se comprobó por fuentes secundarias el RD 311/2022 (ENS), art. 12; RGPD, LOPDGDD y RD 1112/2018 están **sin verificar**. El usuario quiere terminar antes la interfaz y probar con VinfoPol.

## Reglas importantes (trampas conocidas)
1. **Versión de archivos:** todos los `import … from './x.js?v=AAAAMMDDx'`, los `<script>`/`<link>` de `index.html` y el nombre de caché de `sw.js` llevan el mismo número de versión. **Cámbialo en todos a la vez en cada publicación** (`for f in js/*.js index.html sw.js; do sed -i 's/ANTIGUA/NUEVA/g' $f; done`). Sin esto, la caché de GitHub/CDN mezcla archivos viejos y nuevos y la página se queda **en blanco** (ya ocurrió). Versión actual: ver `index.html`.
2. `boot.js` muestra un aviso con botón «Recargar y actualizar» si la app no arranca. El service worker es red-primero con `cache: 'no-cache'` y no guarda nunca `/api/`.
3. Los nombres de repositorio de GitHub no admiten «ñ». Las subidas necesitan que la app de Claude tenga acceso al repositorio (si da 403: pedir al usuario que lo conceda en https://github.com/apps/claude/installations/select_target).
4. El usuario prueba en iPhone (Safari) y en Mac: comprobar siempre ancho móvil (~390 px) y escritorio.
5. Publicar = commit + `git push origin main` (no usar PR salvo que lo pida). Terminar los commits con las líneas de atribución que indique el sistema.

## Pruebas
Ver `pruebas/LEEME.md` (Playwright con callejero simulado; sin Internet). Tras cualquier cambio: `node pruebas/local.js` y mirar capturas con `pruebas/ui.js`.

## Pendiente / ideas
- Probar con un Excel/CSV real de **VinfoPol** y ajustar la detección de columnas.
- Subir `escudo.png` a la raíz (ahora sale un emblema genérico; ver `ESCUDO.md`).
- Escribir la documentación para Informática y decidir alojamiento (ver «Servidor»).
- No hay edición de vértices de un trazado ya dibujado (se redibuja).
