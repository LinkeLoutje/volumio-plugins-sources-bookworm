'use strict';

/*
 * Kleine vertaalhulp voor teksten die index.js zelf opbouwt (de dynamische
 * secties van de configuratiepagina en toasts). Teksten in UIConfig.json
 * vertaalt Volumio zelf via commandRouter.i18nJson.
 *
 * Volgorde: gekozen taal -> Engels -> de sleutel zelf (zodat een ontbrekende
 * vertaling zichtbaar is in plaats van een lege tekst).
 * Variabelen: t('KEY', { uid: '04A1' }) vervangt {uid} in de tekst.
 */

const fs = require('fs');
const path = require('path');

function loadStrings(dir, lang) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, `strings_${lang}.json`), 'utf8'));
    } catch (e) {
        return {};
    }
}

function createTranslator(dir, lang) {
    const english = loadStrings(dir, 'en');
    const chosen = lang && lang !== 'en' ? loadStrings(dir, lang) : {};

    return function t(key, vars) {
        let text = chosen[key] !== undefined ? chosen[key]
            : english[key] !== undefined ? english[key]
                : key;
        if (vars) {
            for (const name of Object.keys(vars)) {
                text = text.split(`{${name}}`).join(String(vars[name]));
            }
        }
        return text;
    };
}

module.exports = { createTranslator };
