FROM --platform=$BUILDPLATFORM node:20-slim AS frontend
WORKDIR /app
COPY dj-prep-tool/package.json dj-prep-tool/package-lock.json ./
RUN npm ci
COPY dj-prep-tool/index.html dj-prep-tool/vite.config.ts dj-prep-tool/tsconfig.json ./
COPY dj-prep-tool/src ./src
RUN npx tsc --noEmit && npx vite build

FROM python:3.11-slim

WORKDIR /app
COPY dj-prep-tool/py ./py
COPY lib ./lib
COPY dj-prep-tool/web ./web
COPY --from=frontend /app/dist ./dist
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir requests yt-dlp numpy scipy

ENV DJ_PREP_DATA_DIR=/data
ENV DJ_PREP_INBOX_DIR=/music/inbox
ENV DJ_PREP_ARCHIVE_DIR=/music/archive
EXPOSE 8080
CMD ["python", "web/server.py"]
