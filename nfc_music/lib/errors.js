'use strict';

/*
 * Fout met een code, zodat index.js de melding in de taal van de gebruiker
 * kan tonen (sleutel ERR_<code> in i18n/strings_*.json). De Engelse tekst is
 * de gewone foutmelding (voor logs en tests).
 */

const path = require('path');
const { createTranslator } = require('./i18n');

const english = createTranslator(path.join(__dirname, '..', 'i18n'), 'en');

class PluginError extends Error {
    constructor(code, params) {
        super(english('ERR_' + code, params));
        this.name = 'PluginError';
        this.code = code;
        this.params = params || {};
    }
}

module.exports = { PluginError };
