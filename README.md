# Mapa de cortes de calle · Don Benito (MVP)

Aplicación web sin servidor: se sirve como archivos estáticos
(p. ej. GitHub Pages → `https://murpix56.github.io/cortes-don-benito/`).

## Qué hace esta versión
- Plano de Don Benito (OpenStreetMap, o satélite PNOA/IGN desde el menú ⋯).
- **Nuevo corte → dibujar**:
  - *Siguiendo calles*: tocas inicio y fin y la aplicación traza el tramo por las calles reales
    (callejero de OpenStreetMap descargado una vez y guardado en el dispositivo). Con puntos
    intermedios se fuerza el recorrido; con «Nuevo tramo» se añaden tramos separados al mismo corte.
  - *Trazado libre*: línea punto a punto sin ajustarse a las calles.
- Ficha del corte: calle, tramo, tipo, motivo, organismo, inicio/fin, desvío, observaciones,
  y texto de duración («Hasta hoy a las 11:00 · quedan 2 h»).
- Filtro por fecha y hora: *en ese instante*, *todo ese día* o *todos*. Estado automático
  (activo / programado / finalizado).
- Exportar/Importar **GeoJSON** (copia de seguridad y paso entre equipos), exportar a **Excel (CSV)**, imprimir/PDF.

## Limitaciones conocidas
- Los cortes se guardan **solo en el dispositivo** (localStorage). No hay usuarios ni base de datos compartida todavía.
- La importación desde Excel/Binfopol no está incluida (pendiente de ver un fichero real).
- El callejero se descarga de Overpass API la primera vez (requiere conexión). Sin él, queda el trazado libre.
- Verificar licencias y atribuciones de cartografía antes de publicar abiertamente.
