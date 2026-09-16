-- dj-prep-tool/migrations/001_schema.sql
-- Run as: psql -U platform_admin -d audiotool -f migrations/001_schema.sql
-- or inside psql: \i migrations/001_schema.sql
-- The audiotool database and roles must already exist (managed by rpi-postgresql repo).

SET ROLE audiotool_owner;

CREATE TABLE IF NOT EXISTS tracks (
    id                BIGSERIAL PRIMARY KEY,
    artist            TEXT NOT NULL DEFAULT '',
    title             TEXT NOT NULL DEFAULT '',
    mix_version       TEXT,
    source_url        TEXT,
    import_tag        TEXT,
    state             TEXT NOT NULL DEFAULT 'requested',
    candidate_json    TEXT,
    selected_username TEXT,
    selected_filename TEXT,
    downloaded_path   TEXT,
    quality_result    TEXT,
    quality_notes     TEXT,
    archive_path      TEXT,
    dj_path           TEXT,
    search_job_id     TEXT,
    download_job_id   TEXT,
    error             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id         BIGSERIAL PRIMARY KEY,
    track_id   BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    from_state TEXT,
    to_state   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlists (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    source     TEXT NOT NULL DEFAULT 'manual',
    source_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (playlist_id, track_id)
);

-- Shared updated_at trigger function (idempotent via CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tracks_updated_at ON tracks;
CREATE TRIGGER tracks_updated_at
    BEFORE UPDATE ON tracks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS playlists_updated_at ON playlists;
CREATE TRIGGER playlists_updated_at
    BEFORE UPDATE ON playlists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Activity logging trigger function
CREATE OR REPLACE FUNCTION log_track_activity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO activities (track_id, to_state) VALUES (NEW.id, NEW.state);
    ELSIF TG_OP = 'UPDATE' AND OLD.state IS DISTINCT FROM NEW.state THEN
        INSERT INTO activities (track_id, from_state, to_state)
        VALUES (NEW.id, OLD.state, NEW.state);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tracks_activity_insert ON tracks;
CREATE TRIGGER tracks_activity_insert
    AFTER INSERT ON tracks
    FOR EACH ROW EXECUTE FUNCTION log_track_activity();

DROP TRIGGER IF EXISTS tracks_activity_state_change ON tracks;
CREATE TRIGGER tracks_activity_state_change
    AFTER UPDATE OF state ON tracks
    FOR EACH ROW EXECUTE FUNCTION log_track_activity();

-- Performance indexes
CREATE INDEX IF NOT EXISTS tracks_state_idx ON tracks (state);
CREATE INDEX IF NOT EXISTS tracks_created_at_idx ON tracks (created_at DESC);
CREATE INDEX IF NOT EXISTS activities_track_id_idx ON activities (track_id);
CREATE INDEX IF NOT EXISTS activities_created_at_idx ON activities (created_at DESC);
CREATE INDEX IF NOT EXISTS playlist_tracks_playlist_id_idx ON playlist_tracks (playlist_id);

-- Grant runtime role access to all objects created above
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO audiotool;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO audiotool;
