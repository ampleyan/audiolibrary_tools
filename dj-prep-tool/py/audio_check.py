"""
py/audio_check.py
-----------------
Quality-check a single audio file via FFT analysis.
Called by the Tauri backend via subprocess.

Usage: python audio_check.py <file_path>
Output (stdout): JSON { is_real_flac: bool|null, notes: string }
  is_real_flac = null for non-FLAC formats (check is not applicable).
"""

import sys
import json
import io
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


def check(path):
    ext = Path(path).suffix.lower()

    if ext != ".flac":
        return {"is_real_flac": None, "notes": f"{ext.lstrip('.') or 'unknown'} file; FFT check not applicable"}

    from lib.audio import AudioAnalyzer

    captured = io.StringIO()
    saved = sys.stdout
    sys.stdout = captured
    try:
        is_real = AudioAnalyzer.is_real_flac(path)
    finally:
        sys.stdout = saved

    notes = captured.getvalue().strip()
    return {"is_real_flac": None if is_real is None else bool(is_real), "notes": notes}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: audio_check.py <path>"}), file=sys.stderr)
        sys.exit(1)
    try:
        result = check(sys.argv[1])
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
