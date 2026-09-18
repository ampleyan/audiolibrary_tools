SET ROLE audiotool_owner;

CREATE TABLE IF NOT EXISTS download_batches (
    id              BIGSERIAL PRIMARY KEY,
    track_id        BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL DEFAULT 'files',
    source_job_id   TEXT NOT NULL,
    source_username TEXT,
    source_folder   TEXT,
    state           TEXT NOT NULL DEFAULT 'queued',
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT download_batches_kind_check CHECK (kind IN ('files', 'folder'))
);

CREATE TABLE IF NOT EXISTS download_items (
    id               BIGSERIAL PRIMARY KEY,
    batch_id         BIGINT NOT NULL REFERENCES download_batches(id) ON DELETE CASCADE,
    track_id         BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    username         TEXT NOT NULL,
    filename         TEXT NOT NULL,
    download_job_id  TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'queued',
    downloaded_path  TEXT,
    bytes_on_disk    BIGINT,
    bytes_total      BIGINT,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, username, filename)
);

CREATE OR REPLACE FUNCTION set_download_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS download_batches_updated_at ON download_batches;
CREATE TRIGGER download_batches_updated_at
    BEFORE UPDATE ON download_batches
    FOR EACH ROW EXECUTE FUNCTION set_download_updated_at();

DROP TRIGGER IF EXISTS download_items_updated_at ON download_items;
CREATE TRIGGER download_items_updated_at
    BEFORE UPDATE ON download_items
    FOR EACH ROW EXECUTE FUNCTION set_download_updated_at();

CREATE INDEX IF NOT EXISTS download_batches_track_id_idx ON download_batches (track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS download_items_batch_id_idx ON download_items (batch_id);
CREATE INDEX IF NOT EXISTS download_items_track_id_idx ON download_items (track_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON download_batches, download_items TO audiotool;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO audiotool;
