# Cortes de calle · Policía Local de Don Benito

Mapa interactivo de cortes de calle con dos vistas:

- **Ciudadanos** (`#/ciudadano`): resumen de cortes activos, filtros *Ahora / Hoy / Mañana / Obras largas*, búsqueda por calle, ficha con duración, desvío y quién autoriza. Solo lectura y solo cortes publicados.
- **Policía Local** (`#/agente`, con usuario y contraseña): alta y edición de cortes sobre el plano, importación desde Excel/CSV, publicación para ciudadanos, historial de actividad y parte imprimible.

## Funciones del panel de agentes
- Dibujo del corte **sobre las calles reales** (tocar inicio y fin; puntos intermedios para forzar el recorrido; varios tramos por corte) o trazado libre.
- Datos: calle, tramo, tipo de afección, motivo, **quién solicita y quién autoriza** (Ayuntamiento, Policía Local, Junta de Extremadura, Diputación de Badajoz, otro organismo + detalle), inicio/fin, desvío, referencia y notas internas.
- **Publicar / retirar** de la vista pública con un interruptor por corte.
- **Importar Excel (.xlsx) o CSV**: detecta columnas, localiza cada fila por calle y cruces «desde/hasta», y deja los cortes **sin publicar** para revisarlos. Plantilla descargable.
- Filtros por fecha y hora (en ese instante / todo el día / todos), tipo y autoridad; indicadores del día.
- **Parte en PDF** (imprimir) con escudo, mapa y tabla; exportación a Excel (CSV) y GeoJSON.
- **Actividad**: quién creó, modificó o borró cada corte y cuándo.

## Puesta en marcha
1. Publicar con GitHub Pages (*Settings → Pages → main / root*).
2. **Escudo:** subir `escudo.png` a la raíz (ver `ESCUDO.md`).
3. **Servidor** (para compartir datos entre agentes y separar de verdad la vista pública): ver `servidor/LEEME.md`. Sin él funciona en *modo de pruebas*, con los datos solo en cada dispositivo.

## Estructura
`index.html`, `style.css`, `config.js` · `js/` (`app.js` interfaz, `store.js` datos local/servidor, `net.js` callejero y rutas, `importer.js` Excel/CSV, `util.js`) · `servidor/supabase.sql` · `vendor/leaflet`.

## Limitaciones conocidas
- No se pueden mover vértices de un trazado ya dibujado: se redibuja o se elimina un tramo.
- Todos los usuarios del servidor tienen el mismo perfil de agente.
- La capa de satélite del IGN y el callejero (OpenStreetMap) dependen de servicios externos; revisar licencias y atribuciones antes de uso público.
- Es una herramienta de apoyo visual: no sustituye a la resolución, bando o decreto que ordene el corte.
