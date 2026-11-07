# Imagen del servidor de cortes de calle (sin dependencias externas).
FROM node:22-slim
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=8080 DB_PATH=/datos/cortes.db WEB_DIR=/app TZ=Europe/Madrid
VOLUME /datos
USER node
EXPOSE 8080
CMD ["node", "servidor/server.mjs"]
