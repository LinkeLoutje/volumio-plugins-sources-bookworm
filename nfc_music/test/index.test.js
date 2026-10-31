'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const fs = require('fs');

// Volumio-/hardwaremodules vervangen, zodat index.js zonder Volumio laadt.
const realLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'pcsclite') return () => ({ on() {}, close() {} });
    if (request === 'axios') return { create: () => ({}) };
    if (request === 'kew') return { resolve: v => v, defer: () => ({}) };
    return realLoad.call(this, request, ...rest);
};
const NfcMusic = require('../index');
Module._load = realLoad;

function makePlugin(lang) {
    const log = [];
    const plugin = new NfcMusic({
        coreCommand: {
            sharedVars: { get: () => lang || 'nl' },
            pushToastMessage: (type, title, msg) => log.push(`toast ${type}: ${msg}`),
            pluginManager: { getConfigurationFile: () => '/tmp/nfc-test/config.json' }
        },
        logger: { info() {}, warn() {}, error: m => log.push('error') }
    });
    plugin.refreshUI = async () => log.push('refresh');
    plugin.controls = { run: async a => log.push('control ' + a.command) };
    plugin.player = { playAlbum: async () => log.push('play album') };
    plugin.running = true;
    return { plugin, log };
}

test('scan: bedieningstag, debounce en altijd UI verversen', async () => {
    const { plugin, log } = makePlugin();
    plugin.tags = {
        A: { name: 'Volume', actions: [{ action: 'control', command: 'volume_up', data: { step: 5 } }] },
        B: { name: 'Album', actions: [{ action: 'play', type: 'album', source: 'local', data: { album: 'X' } }] },
        C: { name: 'Kapot', actions: [{ action: 'playSpotify' }] }
    };
    await plugin.handleScan('A');
    await plugin.handleScan('A');           // dubbel event: genegeerd
    await plugin.handleScan('B');
    await plugin.handleScan('C');           // onbekende actie: fout, geen crash
    await plugin.handleScan('NEW');         // onbekende tag
    assert.deepEqual(log, [
        'control volume_up', 'refresh',
        'play album', 'refresh',
        'error', 'toast error: Kapot: Onbekende actie: playSpotify', 'refresh',
        'toast info: Nieuwe tag gescand: NEW', 'refresh'
    ]);
    assert.equal(plugin.activeTag, 'NEW');
});

test('gestopte instantie en lege UID doen niets (dubbele instantie na herstart)', async () => {
    const { plugin, log } = makePlugin();
    plugin.tags = { A: { name: 'Volume', actions: [{ action: 'control', command: 'toggle', data: {} }] } };
    plugin.running = false;
    await plugin.handleScan('A');
    plugin.running = true;
    await plugin.handleScan('');
    assert.deepEqual(log, ['error']);
});

test('formulier -> tags.json -> formulier geeft dezelfde bedieningstag terug', () => {
    const { plugin } = makePlugin();
    const action = plugin.buildActionFromForm('control_volume_set', { volume_value: '0' });
    assert.deepEqual(action, { action: 'control', command: 'volume_set', data: { value: 0 } });
    assert.equal(plugin.combinedActionTypeKey(action), 'control_volume_set');
    assert.deepEqual(plugin.buildActionFromForm('control_volume_up', { volume_step_up: '999' }).data, { step: 100 });
    assert.deepEqual(plugin.buildActionFromForm('control_toggle', {}), { action: 'control', command: 'toggle', data: {} });
    assert.equal(plugin.buildActionFromForm('control_stop', {}), null);
});

test('elk invoerveld van "Tag bewerken" staat in saveButton.data (les 4)', () => {
    const { plugin } = makePlugin();
    plugin.tags = { A: { name: 'x', actions: [] } };
    plugin.activeEditTag = 'A';
    const section = { content: [] };
    plugin.buildEditTagSection(section);

    const uiconfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'UIConfig.json'), 'utf8'));
    const saveData = uiconfig.sections.find(s => s.id === 'section_edit_tag').saveButton.data;
    const displayOnly = ['edit_tag_uid', 'control_prev_info'];
    const inputs = section.content
        .filter(c => c.element !== 'button' && !displayOnly.includes(c.id))
        .map(c => c.id);

    assert.deepEqual(inputs.filter(id => !saveData.includes(id)), [], 'ontbreekt in saveButton.data');
    assert.deepEqual(saveData.filter(id => !inputs.includes(id)), [], 'staat in saveButton.data maar niet in het formulier');
});

test('alle bedieningsopties staan in de keuzelijst, vertaald', () => {
    const { plugin } = makePlugin('en');
    plugin.tags = { A: { name: 'x', actions: [] } };
    plugin.activeEditTag = 'A';
    const section = { content: [] };
    plugin.buildEditTagSection(section);
    const options = section.content.find(c => c.id === 'actionType').options;
    const labels = options.filter(o => o.value.startsWith('control_')).map(o => o.label);
    assert.deepEqual(labels, [
        'Control: play / pause', 'Control: next track', 'Control: restart track / previous track',
        'Control: volume up', 'Control: volume down', 'Control: set volume'
    ]);
});
