'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { createTranslator } = require('../lib/i18n');

const dir = path.join(__dirname, '..', 'i18n');

test('Nederlands, Engels als terugval, sleutel als laatste redmiddel', () => {
    const t = createTranslator(dir, 'nl');
    assert.equal(t('FIELD_VOLUME_STEP'), 'Stapgrootte');
    assert.equal(createTranslator(dir, 'fr')('FIELD_VOLUME_STEP'), 'Step size');
    assert.equal(t('DOES_NOT_EXIST'), 'DOES_NOT_EXIST');
});

test('variabelen worden ingevuld', () => {
    assert.equal(createTranslator(dir, 'en')('TOAST_NEW_TAG', { uid: '04A1' }), 'New tag scanned: 04A1');
});

test('elke taal heeft precies dezelfde sleutels als Engels', () => {
    const en = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'strings_en.json')))).sort();
    for (const file of fs.readdirSync(dir).filter(f => f.startsWith('strings_'))) {
        const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, file)))).sort();
        assert.deepEqual(keys, en, file);
    }
});

test('elke sleutel uit index.js en UIConfig.json bestaat in strings_en.json', () => {
    const root = path.join(__dirname, '..');
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'strings_en.json')));
    const used = new Set();
    const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
    for (const m of index.matchAll(/\.t\('([A-Z0-9_]+)'\s*[,)]/g)) used.add(m[1]);   // 'ERR_' + code telt niet
    for (const command of require('../lib/controls').COMMANDS) used.add('ACTION_CONTROL_' + command.toUpperCase());
    const uiconfig = fs.readFileSync(path.join(root, 'UIConfig.json'), 'utf8');
    for (const m of uiconfig.matchAll(/"TRANSLATE\.([A-Z0-9_]+)"/g)) used.add(m[1]);
    const missing = [...used].filter(key => en[key] === undefined);
    assert.deepEqual(missing, []);
    assert.ok(used.size > 30, `verwacht meer dan 30 sleutels, gevonden: ${used.size}`);
});

test('elke foutcode heeft een vertaling, en PluginError gebruikt Engels als tekst', () => {
    const { PluginError } = require('../lib/errors');
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'strings_en.json')));
    const root = path.join(__dirname, '..', 'lib');
    const codes = new Set();
    for (const file of fs.readdirSync(root)) {
        const src = fs.readFileSync(path.join(root, file), 'utf8');
        for (const m of src.matchAll(/new PluginError\('([A-Z_]+)'/g)) codes.add(m[1]);
    }
    ['TRACK', 'ALBUM'].forEach(kind => ['NOT_FOUND', 'AMBIGUOUS'].forEach(s => codes.add(`${kind}_${s}`)));
    assert.deepEqual([...codes].filter(code => en['ERR_' + code] === undefined), []);
    const err = new PluginError('TRACK_NOT_FOUND', { wanted: 'Queen - Jazz' });
    assert.equal(err.message, 'Track not found: Queen - Jazz');
    assert.equal(createTranslator(dir, 'nl')('ERR_' + err.code, err.params), 'Nummer niet gevonden: Queen - Jazz');
});

test('geen Nederlandse teksten meer hard in de configuratiepagina', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const literals = [...index.matchAll(/(?:label|value|doc):\s*'([^']{3,})'/g)].map(m => m[1])
        .filter(text => !/^(local_|control_)/.test(text));
    assert.deepEqual(literals, []);
});
