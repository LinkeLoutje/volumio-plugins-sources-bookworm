'use strict';

const axios = require('axios');
const SpotifyPlayer = require('./spotify-player');

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

    // -----------------------------
    // SPOTIFY
    // -----------------------------
    async playSpotify(data) {

        this.logger.info(
            `NFC Music: Spotify starten type=${data.type} uri=${data.uri}`
        );

        switch (data.type) {

            case 'track':
                return await this.spotifyPlayTrack(data.uri);

            case 'album':
            case 'playlist':
                return await this.spotifyPlayContext(data.uri);

            default:
                throw new Error(`Unknown Spotify type: ${data.type}`);
        }
    }

    // -----------------------------
    // SPOTIFY Helpers
    // -----------------------------
    async spotifyPlayTrack(uri) {
        return this.spotifyCall({
            uris: [uri]
        });
    }

    async spotifyPlayContext(uri) {
        return this.spotifyCall({
            context_uri: uri
        });
    }
    // Spotify core call
    async spotifyCall(body) {

        this.logger.info(
            `Spotify API call: ${JSON.stringify(body)}`
        );

        const token = await this.getSpotifyToken();

        const response = await axios.put(
            'https://api.spotify.com/v1/me/player/play',
            body,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        this.logger.info(
            `Spotify response: ${response.status}`
        );

        return response.status === 204;
    }
    // Token hook (tijdelijke stub)
    async getSpotifyToken() {
        throw new Error('Wire spotify-auth/token-store here');
    }

}

module.exports = Player;