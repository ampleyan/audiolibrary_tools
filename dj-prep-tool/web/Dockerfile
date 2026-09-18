FROM node:20-slim AS frontend
WORKDIR /app
COPY dj-prep-tool/package.json dj-prep-tool/package-lock.json ./
RUN npm ci --include=optional
COPY dj-prep-tool/index.html dj-prep-tool/vite.config.ts dj-prep-tool/tsconfig.json ./
COPY dj-prep-tool/src ./src
RUN npx tsc --noEmit && npx vite build

FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gnupg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 && \
    rm -rf /var/lib/apt/lists/*
COPY dj-prep-tool/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt requests yt-dlp numpy scipy
COPY dj-prep-tool/py ./py
COPY lib ./lib
COPY dj-prep-tool/web ./web
COPY --from=frontend /app/dist ./dist

ENV DJ_PREP_DATA_DIR=/data
ENV DJ_PREP_INBOX_DIR=/music/inbox
ENV DJ_PREP_ARCHIVE_DIR=/music/archive
ENV PYTHONPATH=/app
EXPOSE 8080
CMD ["python", "web/server.py"]
