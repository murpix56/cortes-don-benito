# Pruebas automáticas (Playwright)

Requieren Node.js y Playwright instalado en global (`npm i -g playwright`; el navegador ya viene en el entorno de Claude Code).
Se ejecutan desde la raíz del repositorio y sirven la aplicación en local con un callejero de pruebas (cuadrícula) y teselas simuladas, sin Internet:

    NODE_PATH=$(npm root -g) node pruebas/local.js   # flujo completo: portada, alta, ciudadano, importar xlsx/csv, auditoría, parte, exportar
    NODE_PATH=$(npm root -g) node pruebas/ui.js      # capturas de la interfaz (se guardan en esta carpeta, no se suben)
    NODE_PATH=$(npm root -g) node pruebas/gh.js      # simula GitHub Pages (service worker activo, datos antiguos en el navegador)

Salida esperada de `local.js`: la lista final `ERRORES` solo debe contener avisos 404 (falta `escudo.png`, es normal); cualquier otro error es un fallo.
`common.js` contiene el callejero simulado (rejilla 5×5 con calles «Calle Este-Oeste N» y «Calle Norte-Sur N») y los simuladores de Overpass y de teselas.
Las pruebas del servidor opcional están en `servidor/pruebas.mjs` (`node servidor/pruebas.mjs`, 72 comprobaciones).
