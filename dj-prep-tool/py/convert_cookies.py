"""
py/convert_cookies.py
---------------------
Convert browser-extension JSON cookies to Netscape cookies.txt (yt-dlp format).

Usage: python convert_cookies.py <input.json> [output.txt]
If output.txt is omitted, writes alongside input as input.txt

The JSON format is the array exported by extensions like
"Get cookies.txt LOCALLY" or "Cookie-Editor" for Chrome/Firefox.
"""

import sys
import json
import math
from pathlib import Path


def to_netscape(cookies):
    lines = ["# Netscape HTTP Cookie File"]
    for c in cookies:
        domain = c.get("domain", "")
        host_only = c.get("hostOnly", True)
        path = c.get("path", "/")
        secure = c.get("secure", False)
        exp = c.get("expirationDate") or c.get("expiry") or 0
        name = c.get("name", "")
        value = c.get("value", "")

        domain_flag = "FALSE" if host_only else "TRUE"
        secure_flag = "TRUE" if secure else "FALSE"
        expires = str(int(math.floor(float(exp)))) if exp else "0"

        lines.append("\t".join([domain, domain_flag, path, secure_flag, expires, name, value]))

    return "\n".join(lines) + "\n"


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert_cookies.py <input.json> [output.txt]")
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"File not found: {src}")
        sys.exit(1)

    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".txt")

    data = json.loads(src.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        print("Expected a JSON array of cookie objects")
        sys.exit(1)

    dst.write_text(to_netscape(data), encoding="utf-8")
    print(f"Wrote {len(data)} cookies to {dst}")


if __name__ == "__main__":
    main()
