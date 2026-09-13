const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../userscripts/cosine-export.user.js'), 'utf8');

function run(names, failDownload = false) {
    const elements = [];
    const alerts = [];
    const blobs = [];
    const timers = [];
    const revoked = [];
    let downloads = 0;
    let observer;
    const document = {
        documentElement: {},
        body: { appendChild: element => elements.push(element) },
        getElementById: id => elements.find(element => element.id === id),
        querySelectorAll: selector => {
            assert.equal(selector, '.track-row');
            return names.map(name => ({ querySelector: selector => {
                assert.equal(selector, '.track-name');
                return name === null ? null : { textContent: name };
            } }));
        },
        createElement: tag => {
            const element = {
                tag, style: {},
                addEventListener: (event, handler) => { element[event] = handler; },
                click: () => {
                    if (failDownload) throw new Error('download failed');
                    downloads++;
                },
                remove: () => elements.splice(elements.indexOf(element), 1)
            };
            return element;
        }
    };
    const context = {
        document, Blob,
        location: { pathname: '/track/5604469-os-salientes-fofucha-preparada' },
        alert: message => alerts.push(message),
        setTimeout: (callback, delay) => { assert.equal(delay, 30000); timers.push(callback); },
        URL: {
            createObjectURL: blob => { blobs.push(blob); return 'blob:test'; },
            revokeObjectURL: url => revoked.push(url)
        },
        MutationObserver: class {
            constructor(callback) { observer = callback; }
            observe() {}
        }
    };
    vm.runInNewContext(source, context);
    observer();
    assert.equal(elements.length, 1);
    const button = elements[0];
    button.click();
    assert.equal(elements.length, 1);
    timers.forEach(callback => callback());
    assert.equal(revoked.length, blobs.length);
    button.remove();
    observer();
    assert.equal(elements.length, 1);
    return { alerts, blobs, downloads, click: () => elements[0].click() };
}

(async () => {
    const names = [
        'Os Salientes - Fofucha Preparada',
        'Dave Nunes, Bronka - Volt Mix A\u0301cido Envolvente',
        'DJ Fixx - Switch - The Lost Track (Looped-up Dub)',
        'Ace-1 - Rave Stomp II',
        'Artist - A "Quoted" Title',
        'Os Salientes - Fofucha Preparada',
        'Dave Nunes, Bronka - Volt Mix Ácido Envolvente',
        'Unsplit title', null, ' - Missing Artist', 'Missing Title - '
    ];
    const result = run(names);
    assert.equal(result.downloads, 1);
    assert.equal(result.blobs[0].type, 'text/csv;charset=utf-8');
    assert.equal(await result.blobs[0].text(),
        'artist,title\r\n'
        + 'Os Salientes,Fofucha Preparada\r\n'
        + '"Dave Nunes, Bronka",Volt Mix Ácido Envolvente\r\n'
        + 'DJ Fixx,Switch - The Lost Track (Looped-up Dub)\r\n'
        + 'Ace-1,Rave Stomp II\r\n'
        + 'Artist,"A ""Quoted"" Title"\r\n');
    assert.match(result.alerts[0], /5 tracks.*\nDuplicates removed: 2.*\nSkipped: 4/);
    names.splice(0, names.length, 'New Artist - New Track');
    result.click();
    assert.match(await result.blobs[1].text(), /New Artist,New Track/);
    assert.equal(run([]).blobs.length, 0);
    assert.equal(run(['Unsplit title']).blobs.length, 0);
    const failure = run(['Artist - Title'], true);
    assert.match(failure.alerts[0], /CSV export failed: download failed/);
    console.log('Cosine export checks passed: CSV, parsing, duplicates, missing names, refreshed rows, button remount, download cleanup and errors.');
})().catch(error => { console.error(error); process.exitCode = 1; });
