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
