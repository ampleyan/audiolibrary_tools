// ==UserScript==
// @name         Navidrome M3U Export
// @namespace    navidrome-export
// @version      2.3
// @description  Adds an Export M3U button - Fixes "Identifier already declared" error
// @match        *://music.sweatlana.live/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const ND_USER = 'ampleyan';
    const ND_PASS = 'Xus70aiaf71';
    const MUSIC_ROOT = 'D:\\MUSIC';

    let _token = null;

    async function getToken() {
        if (_token) return _token;
        const res = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: ND_USER, password: ND_PASS }),
        });
        const data = await res.json();
        _token = data.token;
        return _token;
    }

    async function fetchPlaylistTracks(playlistId) {
        const token = await getToken();
        const res = await fetch(`/api/playlist/${playlistId}/tracks?_start=0&_end=10000`, {
            headers: { 'x-nd-authorization': `Bearer ${token}` },
        });
        return res.ok ? res.json() : null;
    }

    async function fetchPlaylistName(playlistId) {
        const token = await getToken();
        const res = await fetch(`/api/playlist/${playlistId}`, {
            headers: { 'x-nd-authorization': `Bearer ${token}` },
        });
        const data = await res.json();
        return data.name || playlistId;
    }

    function buildM3U(tracks) {
        const lines = ['#EXTM3U'];
        for (const track of tracks) {
            const dur = track.duration != null ? Math.round(track.duration) : -1;
            const display = track.artist && track.title ? `${track.artist} - ${track.title}` : (track.title || 'Unknown');
            const hostPath = (MUSIC_ROOT + '\\' + track.path).replace(/\//g, '\\');
            lines.push(`#EXTINF:${dur},${display}`, hostPath);
        }
        return lines.join('\n') + '\n';
    }

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: 'audio/x-mpegurl' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function getPlaylistIdFromUrl() {
        const match = window.location.hash.match(/\/playlist\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    function injectButton() {
        const playlistId = getPlaylistIdFromUrl();
        if (!playlistId) {
            document.getElementById('nd-export-btn')?.remove();
            return;
        }

        const toolbar = document.querySelector('[class*="toolbar"], [class*="action"], [class*="controls"], button[title*="Play"]')?.parentElement;
        if (!toolbar || toolbar.querySelector('#nd-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'nd-export-btn';
        btn.textContent = '⬇ M3U';
        Object.assign(btn.style, {
            marginLeft: '10px',
            padding: '4px 8px',
            cursor: 'pointer',
            background: 'rgba(255,255,255,0.1)',
            color: 'inherit',
            border: '1px solid currentColor',
            borderRadius: '4px',
            fontSize: '0.8em'
        });

        btn.onclick = async (e) => {
            e.preventDefault();
            btn.textContent = '...';
            const id = getPlaylistIdFromUrl();
            const [tracks, name] = await Promise.all([fetchPlaylistTracks(id), fetchPlaylistName(id)]);
            if (tracks) downloadText(`${name}.m3u`, buildM3U(tracks));
            btn.textContent = '⬇ M3U';
        };

        toolbar.appendChild(btn);
    }

    // DISCONNECT OLD OBSERVER IF IT EXISTS
    if (window.nd_m3u_observer) {
        window.nd_m3u_observer.disconnect();
    }

    // ASSIGN TO WINDOW OBJECT TO AVOID "ALREADY DECLARED" ERRORS
    window.nd_m3u_observer = new MutationObserver(() => injectButton());
    window.nd_m3u_observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('hashchange', () => {
        document.getElementById('nd-export-btn')?.remove();
        setTimeout(injectButton, 500);
    });

    setTimeout(injectButton, 1000);
})();