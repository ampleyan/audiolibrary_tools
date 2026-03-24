"""
lib/red_api.py
--------------
Redacted.sh (RED) API client and file-list parser.
"""

import re
import time

import requests


class RedAPI:
    """
    REST client for the Redacted.sh API with automatic rate limiting.
    RED allows 5 requests per 10 seconds (2.1 s minimum between requests).
    """

    RATE_LIMIT_SECS = 2.1

    def __init__(self, api_key: str, base_url: str, passkey: str = ''):
        self.api_key  = api_key
        self.passkey  = passkey
        self.base_url = base_url.rstrip('/')
        self.session  = requests.Session()
        self.session.headers.update({'Authorization': api_key})
        self._last_req = 0.0

    def _get(self, path: str, params: dict) -> dict:
        elapsed = time.time() - self._last_req
        if elapsed < self.RATE_LIMIT_SECS:
            time.sleep(self.RATE_LIMIT_SECS - elapsed)
        r = self.session.get(f"{self.base_url}{path}", params=params, timeout=15)
        self._last_req = time.time()
        r.raise_for_status()
        data = r.json()
        if data.get('status') != 'success':
            raise RuntimeError(f"RED API error: {data.get('error', data)}")
        return data['response']

    def search(self, artist: str = '', album: str = '', year: str = '') -> list:
        """Return torrent groups matching artist + album."""
        params = {'action': 'browse'}
        if artist:
            params['artistname'] = artist
        if album:
            params['groupname'] = album
        return self._get('/ajax.php', params).get('results', [])

    def get_torrent(self, torrent_id: int) -> dict:
        """Return full torrent details including file list."""
        return self._get('/ajax.php', {'action': 'torrent', 'id': torrent_id})

    def get_group(self, group_id: int) -> dict:
        """Return full torrent group with all torrents."""
        return self._get('/ajax.php', {'action': 'torrentgroup', 'id': group_id})

    def download_torrent(self, torrent_id: int, dest_path) -> None:
        """
        Download a .torrent file to dest_path (Path or str).

        Tries Authorization header first. Falls back to passkey query param
        if the first attempt returns 401.
        """
        from pathlib import Path
        dest_path = Path(dest_path)

        elapsed = time.time() - self._last_req
        if elapsed < self.RATE_LIMIT_SECS:
            time.sleep(self.RATE_LIMIT_SECS - elapsed)

        params = {'action': 'download', 'id': torrent_id}
        r = self.session.get(
            f"{self.base_url}/torrents.php", params=params, timeout=30
        )
        self._last_req = time.time()

        if r.status_code == 401:
            fallbacks = [{'auth': self.api_key}]
            if self.passkey:
                fallbacks.append({'torrent_pass': self.passkey})
            for extra in fallbacks:
                elapsed = time.time() - self._last_req
                if elapsed < self.RATE_LIMIT_SECS:
                    time.sleep(self.RATE_LIMIT_SECS - elapsed)
                r = self.session.get(
                    f"{self.base_url}/torrents.php",
                    params={**params, **extra},
                    timeout=30,
                )
                self._last_req = time.time()
                if r.status_code != 401:
                    break

        r.raise_for_status()
        dest_path.write_bytes(r.content)


def parse_red_filelist(filelist_str: str) -> list:
    """
    Parse a RED file-list string into [(filename, size_bytes), ...].

    RED format: "name1{{{size1}}}|||name2{{{size2}}}"
    """
    files = []
    for entry in filelist_str.split('|||'):
        entry = entry.strip()
        if not entry:
            continue
        m = re.match(r'^(.+)\{\{\{(\d+)\}\}\}$', entry)
        if m:
            files.append((m.group(1).strip(), int(m.group(2))))
    return files
