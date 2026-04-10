FROM nginx:alpine

# Удаляем дефолтный конфиг
RUN rm /etc/nginx/conf.d/default.conf

# Копируем шаблон конфига
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Копируем статику
COPY public/ /usr/share/nginx/html/

# ENV переменные (подставляются envsubst'ом nginx-шаблонизатором)
ENV BACKEND_URL=http://backend:8080
ENV FLIBUSTA_URL=https://flibusta.is/booksearch
ENV API_KEY=changeme

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
