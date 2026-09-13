# Optional local Nginx preview. Production uses Cloudflare static assets.
FROM node:24-alpine AS build
WORKDIR /site
COPY index.html style.css analytics.js site.config.json ./
COPY statistics-panel ./statistics-panel
COPY assets ./assets
COPY public ./public
COPY tools/build.mjs ./tools/build.mjs
RUN node tools/build.mjs

FROM nginx:alpine
COPY --from=build /site/dist/ /usr/share/nginx/html/
EXPOSE 80
