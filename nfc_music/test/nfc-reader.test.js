'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { EventEmitter } = require('events');

// Nep-pcsclite: elke aanroep is een nieuwe "verbinding" die we kunnen sturen.
const connections = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'pcsclite') {
        return () => {
            const pcsc = new EventEmitter();
            pcsc.closed = false;
            pcsc.close = () => { pcsc.closed = true; };
            connections.push(pcsc);
            return pcsc;
        };
    }
    return realLoad.call(this, request, ...rest);
};
const NfcReader = require('../lib/nfc-reader');
const { parseUidResponse } = NfcReader;
Module._load = realLoad;

const PRESENT = 0x20;
const EMPTY = 0x10;

// Nep-lezer: antwoordt op transmit met de opgegeven reeks antwoorden.
function fakeReader(responses) {
    const r = new EventEmitter();
    r.name = 'ACS ACR122U';
    r.state = EMPTY;
    r.SCARD_STATE_PRESENT = PRESENT;
    r.SCARD_STATE_EMPTY = EMPTY;
    r.SCARD_SHARE_SHARED = 2;
    r.SCARD_LEAVE_CARD = 0;
    r.sent = [];
    r.closed = false;
    r.close = () => { r.closed = true; };
    r.connect = (opts, cb) => cb(null, 2);
    r.disconnect = (mode, cb) => cb(null);
    r.transmit = (apdu, len, protocol, cb) => {
        r.sent.push(Buffer.from(apdu).toString('hex'));
        cb(null, Buffer.from(responses.shift() || [], 'hex'));
    };
    r.tagOn = () => { r.emit('status', { state: PRESENT }); r.state = PRESENT; };
    r.tagOff = () => { r.emit('status', { state: EMPTY }); r.state = EMPTY; };
    return r;
}

function make() {
    const log = [];
    const tags = [];
    const logger = { info: m => log.push(m), warn: m => log.push('WARN ' + m), error: m => log.push('ERROR ' + m) };
    return { nfc: new NfcReader({ logger, onTag: uid => tags.push(uid) }), log, tags };
}

test.beforeEach(() => { connections.length = 0; });

test('parseUidResponse: UID, lengte-verzoek (6C xx), foutcode, leeg', () => {
    assert.deepEqual(parseUidResponse(Buffer.from('53BAFF431400019000', 'hex')), { uid: '53BAFF43140001' });
    assert.deepEqual(parseUidResponse(Buffer.from('6C07', 'hex')), { retryLe: 7 });
    assert.match(parseUidResponse(Buffer.from('6300', 'hex')).error, /6300/);
    assert.match(parseUidResponse(Buffer.from('9000', 'hex')).error, /lege UID/);
    assert.match(parseUidResponse(Buffer.alloc(0)).error, /te kort/);
});

test('tag lezen: UID wordt doorgegeven', () => {
    const { nfc, tags } = make();
    nfc.start();
    const reader = fakeReader(['53BAFF431400019000']);
    connections[0].emit('reader', reader);
    reader.tagOn();
    assert.deepEqual(tags, ['53BAFF43140001']);
    nfc.stop();
});

test('lezer vraagt andere lengte (6C 07): opnieuw met Le=07, dan UID', () => {
    const { nfc, tags } = make();
    nfc.start();
    const reader = fakeReader(['6C07', '53BAFF431400019000']);
    connections[0].emit('reader', reader);
    reader.tagOn();
    assert.deepEqual(reader.sent, ['ffca000000', 'ffca000007']);
    assert.deepEqual(tags, ['53BAFF43140001']);
    nfc.stop();
});

test('foutantwoord of lege UID: geen scan, wel een duidelijke fout in de log', () => {
    const { nfc, tags, log } = make();
    nfc.start();
    const reader = fakeReader(['6300', '9000']);
    connections[0].emit('reader', reader);
    reader.tagOn(); reader.tagOff(); reader.tagOn();
    assert.deepEqual(tags, []);
    assert.equal(log.filter(l => l.startsWith('ERROR NFC UID uitlezen mislukt')).length, 2);
    nfc.stop();
});

test('na stop() komen scans van de oude lezer nergens meer aan (dubbele instantie)', () => {
    const { nfc, tags } = make();
    nfc.start();
    const reader = fakeReader(['53BAFF431400019000']);
    connections[0].emit('reader', reader);
    nfc.stop();
    reader.tagOn();                                   // oude lezer stuurt nog een melding
    assert.deepEqual(tags, []);
    assert.equal(reader.closed, true);
    assert.equal(reader.listenerCount('status'), 0);
    assert.equal(connections[0].closed, true);
});

test('geen lezer: één waarschuwing, verbinding blijft open, later ingestoken lezer werkt', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { nfc, log, tags } = make();
    nfc.start();
    for (let i = 0; i < 120; i++) t.mock.timers.tick(1000);
    assert.equal(connections.length, 1, 'geen herverbinding zonder fout');
    assert.equal(connections[0].closed, false);
    assert.equal(log.filter(l => l.startsWith('WARN NFC: geen lezer')).length, 1);
    const reader = fakeReader(['04A1B2C39000']);      // stekker erin
    connections[0].emit('reader', reader);
    reader.tagOn();
    assert.deepEqual(tags, ['04A1B2C3']);
    nfc.stop();
});

test('PC/SC-fout: opnieuw verbinden met oplopende wachttijd', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { nfc, log } = make();
    nfc.start();
    connections[0].emit('error', new Error('Service not available'));
    t.mock.timers.tick(5000);
    connections[1].emit('error', new Error('Service not available'));
    t.mock.timers.tick(10000);
    assert.equal(connections.length, 3);
    assert.deepEqual(log.filter(l => l.startsWith('NFC: opnieuw verbinden over')),
        ['NFC: opnieuw verbinden over 5 s', 'NFC: opnieuw verbinden over 10 s']);
    nfc.stop();
});

test('late fout van een gesloten verbinding ("Command cancelled") wordt genegeerd', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { nfc, log } = make();
    nfc.start();
    connections[0].emit('error', new Error('first'));
    connections[0].emit('error', new Error('Command cancelled'));   // na ons close()
    assert.equal(log.filter(l => l.includes('Command cancelled')).length, 0);
    nfc.stop();
});

test('stop() ruimt timers op: geen pogingen meer na onStop', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { nfc } = make();
    nfc.start();
    connections[0].emit('error', new Error('x'));     // herverbinding gepland
    nfc.stop();
    for (let i = 0; i < 300; i++) t.mock.timers.tick(1000);
    assert.equal(connections.length, 1);
});
