#!/usr/bin/env python3
"""Delete all empty playlists from Navidrome via Subsonic API."""

import sys
import hashlib
import secrets
import urllib.request
import urllib.parse
import json

NAVIDROME_URL = "http://localhost:4533"  # change to your server IP/hostname
USERNAME = input("Username: ")
PASSWORD = input("Password: ")

# Subsonic token auth: token = md5(password + salt)
_salt = secrets.token_hex(6)
_token = hashlib.md5((PASSWORD + _salt).encode()).hexdigest()

def api(endpoint, **params):
    q = urllib.parse.urlencode({
        "u": USERNAME, "t": _token, "s": _salt,
        "v": "1.16.1", "c": "cleanup", "f": "json",
        **params
    })
    url = f"{NAVIDROME_URL}/rest/{endpoint}?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as r:
        data = json.load(r)
    resp = data["subsonic-response"]
    if resp["status"] != "ok":
        print(f"API error: {resp.get('error')}")
        sys.exit(1)
    return resp

# Get all playlists
resp = api("getPlaylists")
playlists = resp.get("playlists", {}).get("playlist", [])

empty = [p for p in playlists if p.get("songCount", 0) == 0]

if not empty:
    print("No empty playlists found.")
    sys.exit(0)

print(f"\nFound {len(empty)} empty playlist(s):")
for p in empty:
    print(f"  - {p['name']} (id: {p['id']})")

confirm = input("\nDelete all? [y/N] ").strip().lower()
if confirm != "y":
    print("Aborted.")
    sys.exit(0)

for p in empty:
    api("deletePlaylist", id=p["id"])
    print(f"Deleted: {p['name']}")

print("Done.")
