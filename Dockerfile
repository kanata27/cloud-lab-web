FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html
COPY style.css /usr/share/nginx/html/style.css
COPY analytics.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

EXPOSE 80
