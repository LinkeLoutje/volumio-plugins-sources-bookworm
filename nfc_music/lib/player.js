'use strict';

const axios = require('axios');
const { findTrack, findAlbum } = require('./matcher');

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
            throw new Error('Nummer: geen titel of uri in de tag');
        }

        let item;

        if (track.uri) {
            // Opgeslagen uri = exact deze opname; geen zoekactie nodig.
            item = track;
            this.logger.info(`NFC Music: nummer via uri: ${track.uri}`);
        } else {
            this.logger.info(`NFC Music: nummer zoeken: ${track.artist || '?'} - ${track.title}`);
            const lists = await this.search(track.title);
            item = findTrack(lists, track);
            this.logger.info(`NFC Music: nummer gevonden: ${item.uri}`);
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

        this.logger.info(`NFC Music: nummer gestart: HTTP ${response.status}`);
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
            throw new Error('Album: geen albumnaam in de tag');
        }

        this.logger.info(`NFC Music: album zoeken: ${data.artist || '?'} - ${data.album}`);

        const lists = await this.search(data.album);
        const albumItem = findAlbum(lists, data);

        this.logger.info(`NFC Music: album gevonden: ${albumItem.uri}`);

        const response = await api.post('/replaceAndPlay', {
            service: albumItem.service || 'mpd',
            type: 'folder',
            uri: albumItem.uri
        });

        this.logger.info(`NFC Music: album gestart: HTTP ${response.status}`);
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
            `NFC Music: playlist ophalen: ${data.name}`
        );

        const browseResponse = await api.get('/browse', {
            params: { uri: `playlists/${data.name}` }
        });

        const lists = browseResponse.data && browseResponse.data.navigation
            ? browseResponse.data.navigation.lists
            : [];

        const items = (lists && lists.length > 0) ? (lists[0].items || []) : [];

        if (items.length === 0) {
            throw new Error(`Playlist '${data.name}' is leeg of niet gevonden`);
        }

        this.logger.info(
            `NFC Music: ${items.length} nummer(s) gevonden in playlist '${data.name}', starten...`
        );

        const response = await api.post('/replaceAndPlay', {
            item: items[0],
            list: items,
            index: 0
        });

        this.logger.info(
            `NFC Music: playlist gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

    // -----------------------------
    // SPOTIFY
    // -----------------------------
    async playSpotify(data) {

        this.logger.info(
            `NFC Music: Spotify starten -> type=${data.type} uri=${data.uri}`
        );

        if (!data.uri) {
            throw new Error('playSpotify: geen uri opgegeven');
        }

        const response = await api.post('/replaceAndPlay', {
            service: 'spop',
            uri: data.uri
        });

        this.logger.info(
            `NFC Music: Spotify gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

}

module.exports = Player;