'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// axios vervangen door een nep-API die de verzoeken onthoudt
const calls = [];
let searchItems = [];
const fakeApi = {
    get: async (url, opts) => {
        calls.push(['GET', url, opts && opts.params]);
        return { data: { navigation: { lists: [{ items: searchItems }] } } };
    },
    post: async (url, body) => {
        calls.push(['POST', url, body]);
        return { status: 200 };
    }
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === 'axios') {
        return { create: () => fakeApi };
    }
    return realLoad.call(this, request, ...rest);
};
const Player = require('../lib/player');
Module._load = realLoad;

const logger = { info() {}, warn() {}, error() {} };
const player = new Player({ logger });

test.beforeEach(() => { calls.length = 0; searchItems = []; });

test('tag met uri: direct afspelen zonder zoeken', async () => {
    await player.playTrack({ uri: 'music-library/NAS/a.flac', title: 'A', artist: 'X' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), ['POST', '/replaceAndPlay']);
    assert.equal(calls[0][2].uri, 'music-library/NAS/a.flac');
});

test('tag zonder uri: zoeken en het juiste nummer starten', async () => {
    searchItems = [
        { type: 'song', service: 'mpd', artist: 'Leonard Cohen', album: 'VP', title: 'Hallelujah', uri: 'cohen' },
        { type: 'song', service: 'mpd', artist: 'Jeff Buckley', album: 'Grace', title: 'Hallelujah', uri: 'buckley' }
    ];
    await player.playTrack({ artist: 'Jeff Buckley', title: 'Hallelujah' });
    assert.equal(calls[0][0], 'GET');
    assert.equal(calls[1][2].uri, 'buckley');
});

test('niet eenduidig: fout en er wordt NIETS gestart', async () => {
    searchItems = [
        { type: 'song', artist: 'Leonard Cohen', title: 'Hallelujah', uri: 'cohen' },
        { type: 'song', artist: 'Jeff Buckley', title: 'Hallelujah', uri: 'buckley' }
    ];
    await assert.rejects(player.playTrack({ title: 'Hallelujah' }), /ambiguous/);
    assert.equal(calls.filter(c => c[0] === 'POST').length, 0);
});

test('album: artiest beslist bij dezelfde albumtitel', async () => {
    searchItems = [
        { type: 'folder', service: 'mpd', artist: 'Peter Gabriel', title: 'Greatest Hits', uri: 'pg' },
        { type: 'folder', service: 'mpd', artist: 'Queen', title: 'Greatest Hits', uri: 'queen' }
    ];
    await player.playAlbum({ artist: 'Queen', album: 'Greatest Hits' });
    assert.equal(calls[1][2].uri, 'queen');
    assert.equal(calls[1][2].type, 'folder');
});
