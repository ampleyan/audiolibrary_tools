// ==UserScript==
// @name         Discogs → RED Collection Checker
// @namespace    https://redacted.sh
// @version      1.0.0
// @description  Check your Discogs vinyl collection against Redacted.sh
// @author       Sasha
// @match        https://www.discogs.com/user/*/collection*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @connect      api.discogs.com
// @connect      redacted.sh
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG_KEY = 'red_checker_config';

  const defaults = {
    discogsToken: 'PzdaJngdoEvFdOGcKNZUaMCLTWhvXicaPQTSkThH',
    redApiKey: '51ddb371.4d3e10c3b55d2006a2fc23bf5d3804ca',
    redBaseUrl: 'https://redacted.sh',
    requestDelay: 2000,
  };

  function loadConfig() {
    try {
      return Object.assign({}, defaults, JSON.parse(GM_getValue(CONFIG_KEY, '{}')));
    } catch {
      return Object.assign({}, defaults);
    }
  }

  function saveConfig(cfg) {
    GM_setValue(CONFIG_KEY, JSON.stringify(cfg));
  }

  GM_addStyle(`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Playfair+Display:wght@700&display=swap');

    #red-checker-panel {
      position: fixed;
      top: 60px;
      right: 0;
      width: 420px;
      max-height: 85vh;
      background: #0d0d0d;
      color: #e8e0d0;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      border-left: 2px solid #c8a84b;
      border-bottom: 2px solid #c8a84b;
      border-top: 2px solid #c8a84b;
      box-shadow: -8px 0 40px rgba(0,0,0,0.7);
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.77,0,0.175,1);
    }

    #red-checker-panel.open {
      transform: translateX(0);
    }

    #red-checker-toggle {
      position: fixed;
      top: 60px;
      right: 0;
      z-index: 100000;
      background: #c8a84b;
      color: #0d0d0d;
      border: none;
      padding: 8px 10px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      writing-mode: vertical-lr;
      text-orientation: mixed;
      letter-spacing: 0.1em;
      transition: background 0.2s;
    }

    #red-checker-toggle:hover {
      background: #e0bc60;
    }

    #red-checker-header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    #red-checker-header h2 {
      font-family: 'Playfair Display', serif;
      font-size: 15px;
      color: #c8a84b;
      margin: 0;
      letter-spacing: 0.05em;
    }

    #red-checker-header .subtitle {
      font-size: 10px;
      color: #666;
      margin-top: 2px;
    }

    #red-checker-config {
      padding: 12px 16px;
      border-bottom: 1px solid #1a1a1a;
      flex-shrink: 0;
    }

    #red-checker-config.hidden {
      display: none;
    }

    .rc-field {
      margin-bottom: 8px;
    }

    .rc-field label {
      display: block;
      color: #888;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 3px;
    }

    .rc-field input {
      width: 100%;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #e8e0d0;
      padding: 5px 8px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s;
    }

    .rc-field input:focus {
      border-color: #c8a84b;
    }

    .rc-row {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .rc-btn {
      flex: 1;
      background: transparent;
      border: 1px solid #c8a84b;
      color: #c8a84b;
      padding: 6px 10px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      cursor: pointer;
      letter-spacing: 0.05em;
      transition: all 0.15s;
    }

    .rc-btn:hover {
      background: #c8a84b;
      color: #0d0d0d;
    }

    .rc-btn.primary {
      background: #c8a84b;
      color: #0d0d0d;
      font-weight: 600;
    }

    .rc-btn.primary:hover {
      background: #e0bc60;
    }

    .rc-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    #red-checker-status {
      padding: 8px 16px;
      font-size: 10px;
      border-bottom: 1px solid #1a1a1a;
      flex-shrink: 0;
      min-height: 28px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .rc-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .rc-stat .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .dot-found   { background: #4caf72; }
    .dot-missing { background: #e05252; }
    .dot-pending { background: #c8a84b; animation: pulse 1.2s infinite; }
    .dot-error   { background: #888; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    #red-checker-results {
      overflow-y: auto;
      flex: 1;
      padding: 4px 0;
    }

    #red-checker-results::-webkit-scrollbar { width: 4px; }
    #red-checker-results::-webkit-scrollbar-track { background: #0d0d0d; }
    #red-checker-results::-webkit-scrollbar-thumb { background: #333; }

    .rc-item {
      padding: 8px 16px;
      border-bottom: 1px solid #141414;
      display: grid;
      grid-template-columns: 10px 1fr auto;
      gap: 8px;
      align-items: start;
      transition: background 0.15s;
    }

    .rc-item:hover {
      background: #141414;
    }

    .rc-item-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-top: 4px;
      flex-shrink: 0;
    }

    .rc-item-info {
      min-width: 0;
    }

    .rc-item-title {
      color: #e8e0d0;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rc-item-meta {
      color: #555;
      font-size: 10px;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rc-item-action {
      flex-shrink: 0;
    }

    .rc-item-action a {
      color: #c8a84b;
      text-decoration: none;
      font-size: 10px;
      letter-spacing: 0.05em;
      border-bottom: 1px solid transparent;
      transition: border-color 0.15s;
    }

    .rc-item-action a:hover {
      border-color: #c8a84b;
    }

    .rc-item-action span {
      color: #444;
      font-size: 10px;
    }

    #red-checker-footer {
      padding: 8px 16px;
      border-top: 1px solid #1a1a1a;
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .rc-progress {
      height: 2px;
      background: #1a1a1a;
      flex-shrink: 0;
    }

    .rc-progress-bar {
      height: 100%;
      background: #c8a84b;
      width: 0%;
      transition: width 0.3s ease;
    }

    .config-toggle-link {
      cursor: pointer;
      color: #555;
      font-size: 10px;
      letter-spacing: 0.05em;
      text-decoration: underline;
      background: none;
      border: none;
      font-family: inherit;
      padding: 0;
    }

    .config-toggle-link:hover {
      color: #888;
    }
  `);

  let cfg = loadConfig();
  let running = false;
  let aborted = false;
  let results = [];

  function getDiscogsUsername() {
    const m = location.pathname.match(/\/user\/([^/]+)\/collection/);
    return m ? m[1] : null;
  }

  function buildPanel() {
    const toggle = document.createElement('button');
    toggle.id = 'red-checker-toggle';
    toggle.textContent = 'RED CHECK';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'red-checker-panel';
    panel.innerHTML = `
      <div id="red-checker-header">
        <div>
          <h2>RED Checker</h2>
          <div class="subtitle">Discogs collection → Redacted.sh</div>
        </div>
        <button class="config-toggle-link" id="rc-config-toggle">settings</button>
      </div>
      <div id="red-checker-config">
        <div class="rc-field">
          <label>Discogs API Token</label>
          <input id="rc-discogs-token" type="password" placeholder="your discogs token" value="${cfg.discogsToken}" />
        </div>
        <div class="rc-field">
          <label>RED API Key</label>
          <input id="rc-red-apikey" type="password" placeholder="your redacted.sh api key" value="${cfg.redApiKey}" />
        </div>
        <div class="rc-field">
          <label>RED Base URL</label>
          <input id="rc-red-url" type="text" placeholder="https://redacted.sh" value="${cfg.redBaseUrl}" />
        </div>
        <div class="rc-row">
          <button class="rc-btn" id="rc-save-cfg">Save Config</button>
        </div>
      </div>
      <div class="rc-progress"><div class="rc-progress-bar" id="rc-progress-bar"></div></div>
      <div id="red-checker-status">
        <span style="color:#444">Ready. Configure settings and press Run.</span>
      </div>
      <div id="red-checker-results"></div>
      <div id="red-checker-footer">
        <button class="rc-btn primary" id="rc-run-btn">▶ Run Check</button>
        <button class="rc-btn" id="rc-abort-btn" disabled>■ Abort</button>
        <button class="rc-btn" id="rc-export-btn" disabled>↓ Export</button>
      </div>
    `;
    document.body.appendChild(panel);

    toggle.addEventListener('click', () => {
      panel.classList.toggle('open');
    });

    document.getElementById('rc-config-toggle').addEventListener('click', () => {
      document.getElementById('red-checker-config').classList.toggle('hidden');
    });

    document.getElementById('rc-save-cfg').addEventListener('click', () => {
      cfg.discogsToken = document.getElementById('rc-discogs-token').value.trim();
      cfg.redApiKey = document.getElementById('rc-red-apikey').value.trim();
      cfg.redBaseUrl = document.getElementById('rc-red-url').value.trim().replace(/\/$/, '');
      saveConfig(cfg);
      document.getElementById('rc-save-cfg').textContent = 'Saved ✓';
      setTimeout(() => { document.getElementById('rc-save-cfg').textContent = 'Save Config'; }, 1500);
    });

    document.getElementById('rc-run-btn').addEventListener('click', () => {
      if (!running) startCheck();
    });

    document.getElementById('rc-abort-btn').addEventListener('click', () => {
      aborted = true;
    });

    document.getElementById('rc-export-btn').addEventListener('click', exportCSV);
  }

  function setStatus(html) {
    document.getElementById('red-checker-status').innerHTML = html;
  }

  function buildStatsHtml(found, missing, errors, pending) {
    return `
      <div class="rc-stat"><div class="dot dot-found"></div><span>${found} found</span></div>
      <div class="rc-stat"><div class="dot dot-missing"></div><span>${missing} missing</span></div>
      ${errors > 0 ? `<div class="rc-stat"><div class="dot dot-error"></div><span>${errors} errors</span></div>` : ''}
      ${pending > 0 ? `<div class="rc-stat"><div class="dot dot-pending"></div><span>${pending} checking…</span></div>` : ''}
    `;
  }

  function addResultRow(item) {
    const el = document.createElement('div');
    el.className = 'rc-item';
    el.dataset.id = item.discogsId;

    const dotClass = item.status === 'found' ? 'dot-found'
      : item.status === 'missing' ? 'dot-missing'
      : item.status === 'pending' ? 'dot-pending'
      : 'dot-error';

    const action = item.status === 'found' && item.redUrl
      ? `<a href="${item.redUrl}" target="_blank">VIEW</a>`
      : item.status === 'pending'
      ? `<span>…</span>`
      : `<span>—</span>`;

    el.innerHTML = `
      <div class="rc-item-dot ${dotClass}"></div>
      <div class="rc-item-info">
        <div class="rc-item-title">${escapeHtml(item.artist)} – ${escapeHtml(item.title)}</div>
        <div class="rc-item-meta">${escapeHtml(item.year || '')}${item.format ? ' · ' + escapeHtml(item.format) : ''}</div>
      </div>
      <div class="rc-item-action">${action}</div>
    `;

    document.getElementById('red-checker-results').appendChild(el);
    return el;
  }

  function updateResultRow(item) {
    const el = document.querySelector(`.rc-item[data-id="${item.discogsId}"]`);
    if (!el) return;

    const dotClass = item.status === 'found' ? 'dot-found'
      : item.status === 'missing' ? 'dot-missing'
      : 'dot-error';

    el.querySelector('.rc-item-dot').className = `rc-item-dot ${dotClass}`;

    const action = el.querySelector('.rc-item-action');
    action.innerHTML = item.status === 'found' && item.redUrl
      ? `<a href="${item.redUrl}" target="_blank">VIEW</a>`
      : `<span>—</span>`;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function gmFetch(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: headers || {},
        onload: (r) => resolve(r),
        onerror: (e) => reject(e),
      });
    });
  }

  async function fetchDiscogsCollection(username) {
    let page = 1;
    let all = [];

    while (true) {
      const url = `https://api.discogs.com/users/${username}/collection/folders/0/releases?per_page=100&page=${page}&token=${cfg.discogsToken}`;
      const resp = await gmFetch(url, { 'User-Agent': 'DiscogsREDChecker/1.0' });

      if (resp.status !== 200) throw new Error(`Discogs API error: ${resp.status}`);
      const data = JSON.parse(resp.responseText);
      all = all.concat(data.releases || []);

      if (page >= data.pagination.pages) break;
      page++;
      await delay(1000);
    }

    return all;
  }

  function parseRelease(r) {
    const info = r.basic_information;
    const artist = info.artists && info.artists.length > 0
      ? info.artists[0].name.replace(/\s*\(\d+\)$/, '')
      : 'Unknown';
    const format = info.formats && info.formats.length > 0
      ? info.formats[0].name
      : '';

    return {
      discogsId: r.id,
      artist,
      title: info.title,
      year: info.year || '',
      format,
      status: 'pending',
      redUrl: null,
    };
  }

  async function checkOnRED(item) {
    const query = encodeURIComponent(`${item.artist} ${item.title}`);
    const url = `${cfg.redBaseUrl}/ajax.php?action=browse&searchstr=${query}&filter_cat[1]=1`;

    const resp = await gmFetch(url, {
      'Authorization': cfg.redApiKey,
    });

    if (resp.status === 401 || resp.status === 403) throw new Error('RED auth failed');
    if (resp.status !== 200) throw new Error(`RED API error: ${resp.status}`);

    const data = JSON.parse(resp.responseText);
    if (data.status !== 'success') throw new Error('RED API returned failure');

    const groups = data.response && data.response.results ? data.response.results : [];

    if (groups.length === 0) return { found: false };

    const best = groups[0];
    const redUrl = `${cfg.redBaseUrl}/torrents.php?id=${best.groupId}`;
    return { found: true, redUrl, groupName: best.groupName };
  }

  async function startCheck() {
    const username = getDiscogsUsername();
    if (!username) {
      setStatus('<span style="color:#e05252">Could not detect Discogs username from URL.</span>');
      return;
    }

    cfg.discogsToken = document.getElementById('rc-discogs-token').value.trim();
    cfg.redApiKey = document.getElementById('rc-red-apikey').value.trim();
    cfg.redBaseUrl = document.getElementById('rc-red-url').value.trim().replace(/\/$/, '');
    saveConfig(cfg);

    if (!cfg.discogsToken || !cfg.redApiKey) {
      setStatus('<span style="color:#e05252">Please configure Discogs token and RED API key first.</span>');
      return;
    }

    running = true;
    aborted = false;
    results = [];
    document.getElementById('red-checker-results').innerHTML = '';
    document.getElementById('rc-run-btn').disabled = true;
    document.getElementById('rc-abort-btn').disabled = false;
    document.getElementById('rc-export-btn').disabled = true;
    document.getElementById('red-checker-panel').classList.add('open');
    document.getElementById('red-checker-config').classList.add('hidden');

    setStatus('<span style="color:#c8a84b">Fetching Discogs collection…</span>');

    let releases;
    try {
      releases = await fetchDiscogsCollection(username);
    } catch (e) {
      setStatus(`<span style="color:#e05252">Discogs error: ${escapeHtml(e.message)}</span>`);
      running = false;
      document.getElementById('rc-run-btn').disabled = false;
      document.getElementById('rc-abort-btn').disabled = true;
      return;
    }

    const items = releases.map(parseRelease);

    items.forEach(item => {
      results.push(item);
      addResultRow(item);
    });

    const total = items.length;
    let found = 0, missing = 0, errors = 0, done = 0;

    for (const item of items) {
      if (aborted) break;

      try {
        const result = await checkOnRED(item);
        if (result.found) {
          item.status = 'found';
          item.redUrl = result.redUrl;
          found++;
        } else {
          item.status = 'missing';
          missing++;
        }
      } catch (e) {
        item.status = 'error';
        item.errorMsg = e.message;
        errors++;
      }

      done++;
      updateResultRow(item);

      const pct = Math.round((done / total) * 100);
      document.getElementById('rc-progress-bar').style.width = pct + '%';

      const pending = total - done;
      setStatus(buildStatsHtml(found, missing, errors, pending));

      await delay(cfg.requestDelay);
    }

    const statusMsg = aborted ? ' (aborted)' : '';
    setStatus(buildStatsHtml(found, missing, errors, 0) + `<span style="color:#444;margin-left:auto">${done}/${total}${statusMsg}</span>`);

    running = false;
    aborted = false;
    document.getElementById('rc-run-btn').disabled = false;
    document.getElementById('rc-abort-btn').disabled = true;
    document.getElementById('rc-export-btn').disabled = false;
  }

  function exportCSV() {
    const lines = ['Artist,Title,Year,Format,Status,RED URL'];
    for (const item of results) {
      const row = [item.artist, item.title, item.year, item.format, item.status, item.redUrl || '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
      lines.push(row);
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'discogs-red-check.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  buildPanel();
})();