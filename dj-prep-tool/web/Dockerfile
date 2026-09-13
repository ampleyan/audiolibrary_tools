FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit && npx vite build

FROM python:3.11-slim

WORKDIR /app
COPY py ./py
COPY web ./web
COPY --from=frontend /app/dist ./dist
RUN pip install --no-cache-dir requests yt-dlp

ENV DJ_PREP_DATA_DIR=/data
ENV DJ_PREP_INBOX_DIR=/music/inbox
ENV DJ_PREP_ARCHIVE_DIR=/music/archive
EXPOSE 8080
CMD ["python", "web/server.py"]
