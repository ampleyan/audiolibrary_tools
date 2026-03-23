# yt_slsk.py — YouTube -> Soulseek Batch Downloader

Fetch track titles from a YouTube playlist or channel, clean them, and download via slsk-batchdl.

## Requirements

```
pip install yt-dlp
```

Install slsk-batchdl: https://github.com/fiso64/slsk-batchdl

## Setup

Edit the config block at the top of `yt_slsk.py`:

| Setting | Description |
|---------|-------------|
| `DRY_RUN` | `True` = preview only, no writes. Set `False` to download. |
| `YOUTUBE_URL` | Default playlist/channel URL (can be passed via CLI instead) |
| `SLSKD_CMD` | Path or command name for slsk-batchdl |
| `SLSK_OUTPUT_DIR` | Where slsk-batchdl saves downloaded files |

## Commands

```bash
# Step 1 — preview fetch (DRY_RUN = True, no files written)
python yt_slsk.py --fetch https://youtube.com/playlist?list=...

# Step 1 — fetch and write queue (set DRY_RUN = False first)
python yt_slsk.py --fetch https://youtube.com/playlist?list=...

# Step 1 — use the URL hardcoded in YOUTUBE_URL config
python yt_slsk.py --fetch

# Step 2 — review yt_slsk_queue.csv
# - Fix rows with status=needs_review (no "Artist - Title" format found)
# - Delete rows you don't want
# - Change status=skip to permanently suppress a track

# Step 3 — download (DRY_RUN must be False)
python yt_slsk.py --download
```

## Output Files

| File | Description |
|------|-------------|
| `yt_slsk_queue.csv` | Track queue — edit between fetch and download |
| `yt_slsk_log.json` | Persistent download history (prevents re-downloading) |
| `yt_slsk_not_found.csv` | Tracks not available on Soulseek |
| `yt_slsk_failed.csv` | Tracks that errored during download |

## Tips

- Re-run `--fetch` on the same URL anytime — already downloaded tracks are skipped automatically.
- To retry not-found tracks: change their status to `retry` in `yt_slsk_queue.csv`, then run `--download` again.
- After downloading, run `organize_music.py` on `SLSK_OUTPUT_DIR` to sort files into your library.
