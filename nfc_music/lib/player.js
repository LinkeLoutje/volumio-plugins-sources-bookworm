'use strict';

const axios = require('axios');
const { findTrack, findAlbum } = require('./matcher');
const { PluginError } = require('./errors');

// Eén gedeelde client met timeout: een hangende Volumio-API mag de
// volgende scans niet blokkeren.
const api = axios.create({
    baseURL: 'http://127.0.0.1:3000/api/v1',
    timeout: 8000
});

class Player {

    constructor(options = {}) {
        this.logger = options.logger || console;
        this.commandRouter = options.commandRouter;
    }

    // -----------------------------
    // TRACK
    // -----------------------------
    async playTrack(track) {

        if (!track || (!track.uri && !track.title)) {
            throw new PluginError('TRACK_NO_TITLE');
        }

        let item;

        if (track.uri) {
            // Opgeslagen uri = exact deze opname; geen zoekactie nodig.
            item = track;
            this.logger.info(`NFC Music: track via URI: ${track.uri}`);
        } else {
            this.logger.info(`NFC Music: searching track: ${track.artist || '?'} - ${track.title}`);
            const lists = await this.search(track.title);
            item = findTrack(lists, track);
            this.logger.info(`NFC Music: track found: ${item.uri}`);
        }

        const response = await api.post('/replaceAndPlay', {
            service: item.service || 'mpd',
            type: 'track',
            uri: item.uri,
            title: item.title,
            artist: item.artist,
            album: item.album,
            trackType: item.trackType
        });

        this.logger.info(`NFC Music: track started: HTTP ${response.status}`);
        return response.status === 200;
    }

    // fallback alias (oude compat)
    async playLocal(track) {
        return this.playTrack(track);
    }

    // -----------------------------
    // ALBUM
    // -----------------------------
    async playAlbum(data) {

        if (!data || !data.album) {
            throw new PluginError('ALBUM_NO_NAME');
        }

        this.logger.info(`NFC Music: searching album: ${data.artist || '?'} - ${data.album}`);

        const lists = await this.search(data.album);
        const albumItem = findAlbum(lists, data);

        this.logger.info(`NFC Music: album found: ${albumItem.uri}`);

        const response = await api.post('/replaceAndPlay', {
            service: albumItem.service || 'mpd',
            type: 'folder',
            uri: albumItem.uri
        });

        this.logger.info(`NFC Music: album started: HTTP ${response.status}`);
        return response.status === 200;
    }

    async search(query) {
        const response = await api.get('/search', { params: { query } });
        return (response.data && response.data.navigation && response.data.navigation.lists) || [];
    }

    // -----------------------------
    // PLAYLIST (fix v3: browse + replaceAndPlay, i.p.v. het kapotte
    // interne playlistManager-mechanisme achter cmd=playplaylist)
    // -----------------------------
    async playPlaylist(data) {

        this.logger.info(
            `NFC Music: loading playlist: ${data.name}`
        );

        const browseResponse = await api.get('/browse', {
            params: { uri: `playlists/${data.name}` }
        });

        const lists = browseResponse.data && browseResponse.data.navigation
            ? browseResponse.data.navigation.lists
            : [];

        const items = (lists && lists.length > 0) ? (lists[0].items || []) : [];

        if (items.length === 0) {
            throw new PluginError('PLAYLIST_EMPTY', { name: data.name });
        }

        this.logger.info(
            `NFC Music: ${items.length} track(s) in playlist '${data.name}', starting`
        );

        const response = await api.post('/replaceAndPlay', {
            item: items[0],
            list: items,
            index: 0
        });

        this.logger.info(
            `NFC Music: playlist started: HTTP ${response.status}`
        );

        return response.status === 200;
    }
}

module.exports = Player;