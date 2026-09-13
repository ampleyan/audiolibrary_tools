// ==UserScript==
// @name         Cosine Club Artist/Title CSV Export
// @namespace    cosine-track-export
// @version      1.0.0
// @description  Export loaded source and similar tracks as an artist,title CSV.
// @match        https://cosine.club/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const buttonId = 'cosine-csv-export';

    function exportTracks() {
        const rows = document.querySelectorAll('.track-row');
        const tracks = [];
        const seen = new Set();
        const skipped = [];
        let duplicates = 0;

        for (const row of rows) {
            const name = (row.querySelector('.track-name')?.textContent || '')
                .normalize('NFC').replace(/\s+/g, ' ').trim();
            const separator = name.indexOf(' - ');
            const artist = separator < 0 ? '' : name.slice(0, separator).trim();
            const title = separator < 0 ? '' : name.slice(separator + 3).trim();

            if (!artist || !title) {
                skipped.push(name || '(empty track name)');
                continue;
            }

            const key = JSON.stringify([artist, title]);
            if (seen.has(key)) {
                duplicates++;
                continue;
            }
            seen.add(key);
            tracks.push([artist, title]);
        }

        if (!tracks.length) {
            alert(rows.length
                ? 'No artist/title pairs could be extracted.\n\n' + skipped.join('\n')
                : 'No loaded tracks found. Open a Cosine Club track page and wait for the list to load.');
            return;
        }

        const csv = [['artist', 'title'], ...tracks]
            .map(fields => fields.map(value => /[",\r\n]/.test(value)
                ? '"' + value.replace(/"/g, '""') + '"' : value).join(','))
            .join('\r\n') + '\r\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const page = location.pathname.split('/').filter(Boolean).pop() || 'tracks';
        link.download = `cosine-${page.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}.csv`;

        try {
            document.body.appendChild(link);
            link.click();
        } finally {
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
        }

        alert(`CSV download started: ${tracks.length} tracks.\nDuplicates removed: ${duplicates}.\nSkipped: ${skipped.length}.`
            + (skipped.length ? '\n\nCould not split these names:\n' + skipped.join('\n') : ''));
    }

    function addButton() {
        if (!document.body || document.getElementById(buttonId)) return;
        const button = document.createElement('button');
        button.id = buttonId;
        button.type = 'button';
        button.textContent = 'Export CSV';
        button.title = 'Export all loaded source and similar tracks as artist,title';
        button.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;'
            + 'padding:12px 18px;min-height:44px;background:#181818;color:#fff;'
            + 'border:1px solid #aaa;border-radius:6px;font:600 14px system-ui;cursor:pointer;';
        button.addEventListener('click', () => {
            try {
                exportTracks();
            } catch (error) {
                alert(`CSV export failed: ${error.message}`);
            }
        });
        document.body.appendChild(button);
    }

    addButton();
    new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();
