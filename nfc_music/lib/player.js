'use strict';

const axios = require('axios');

class Player {

    constructor(options = {}) {
        this.logger = options.logger || console;
    }

    // -----------------------------
    // TRACK
    // -----------------------------
    async playTrack(track) {

        this.logger.info(
            `NFC Music: track starten: ${track.title}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: track.service || 'mpd',
                type: 'track',
                uri: track.uri,
                title: track.title,
                artist: track.artist,
                album: track.album,
                trackType: track.trackType
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: track gestart: HTTP ${response.status}`
        );

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

        this.logger.info(
            `NFC Music: album zoeken: ${data.artist} - ${data.album}`
        );

        const searchResponse = await axios.get(
            'http://127.0.0.1:3000/api/v1/search',
            {
                params: {
                    query: data.album
                }
            }
        );

        const lists = searchResponse.data?.navigation?.lists || [];

        let albumItem = null;

        for (const list of lists) {

            const items = list.items || [];

            albumItem = items.find(item =>
                item.type === 'folder' &&
                item.artist === data.artist &&
                item.title === data.album
            );

            if (albumItem) break;
        }

        if (!albumItem) {
            throw new Error(
                `Album niet gevonden: ${data.artist} - ${data.album}`
            );
        }

        this.logger.info(
            `NFC Music: album gevonden: ${albumItem.uri}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'mpd',
                type: 'folder',
                uri: albumItem.uri
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: album gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

    // -----------------------------
    // PLAYLIST
    // -----------------------------
    async playPlaylist(data) {

        this.logger.info(
            `NFC Music: playlist starten: ${data.name}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'mpd',
                type: 'playlist',
                name: data.name
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: playlist gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }
}

module.exports = Player;