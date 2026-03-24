"""
navidrome_export.py
-------------------
Export a Navidrome playlist to M3U format.

Usage:
    python scripts/navidrome_export.py [playlist_name] [output.m3u]

Configuration: edit NAVIDROME_DB_PATH and NAVIDROME_MUSIC_FOLDER in config.py.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os
import sqlite3

import config


def export_playlist_m3u(db_path, playlist_name, output_path):
    conn = sqlite3.connect(db_path)
    cur  = conn.cursor()

    cur.execute("SELECT id FROM playlist WHERE name = ?", (playlist_name,))
    row = cur.fetchone()
    if not row:
        print(f"Playlist '{playlist_name}' not found")
        sys.exit(1)

    playlist_id = row[0]
    cur.execute("""
        SELECT mf.path, mf.title, mf.artist, mf.duration
        FROM playlist_tracks pt
        JOIN media_file mf ON pt.media_file_id = mf.id
        WHERE pt.playlist_id = ?
    """, (playlist_id,))
    tracks = cur.fetchall()
    conn.close()

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n")
        for path, title, artist, duration in tracks:
            abs_path = os.path.join(config.NAVIDROME_MUSIC_FOLDER, path)
            dur_int  = int(duration) if duration else -1
            display  = (f"{artist} - {title}" if artist and title
                        else (title or os.path.basename(path)))
            f.write(f"#EXTINF:{dur_int},{display}\n")
            f.write(abs_path + "\n")

    print(f"Exported {len(tracks)} tracks to {output_path}")


if __name__ == "__main__":
    playlist_name = sys.argv[1] if len(sys.argv) > 1 else "UKG"
    output_path   = sys.argv[2] if len(sys.argv) > 2 else f"{playlist_name}.m3u"
    export_playlist_m3u(config.NAVIDROME_DB_PATH, playlist_name, output_path)
