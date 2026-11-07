FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NITRO_PORT=3000 NUXT_DATA_DIR=/data VD_VERSION=1.0.0
RUN apk add --no-cache ffmpeg libheif-tools && mkdir -p /data /speicher && chown node:node /data /speicher
COPY --chown=node:node .output ./.output
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/public/health >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
