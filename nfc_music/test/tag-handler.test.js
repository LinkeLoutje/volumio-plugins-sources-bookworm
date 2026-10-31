'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleTagAction } = require('../lib/tag-handler');

const logger = { info() {} };
const player = { playAlbum: async () => 'album' };

test('Spotify-tags geven een duidelijke fout in plaats van een crash', async () => {
    await assert.rejects(
        handleTagAction({ action: 'play', type: 'album', source: 'spotify', data: { uri: 'spotify:album:x' } }, player, logger),
        /Spotify is not supported/
    );
});

test('lokale tags werken nog gewoon', async () => {
    assert.equal(await handleTagAction({ action: 'play', type: 'album', source: 'local', data: {} }, player, logger), 'album');
});
