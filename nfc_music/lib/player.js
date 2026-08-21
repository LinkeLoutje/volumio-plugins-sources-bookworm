'use strict';

const axios = require('axios');
// const SpotifyPlayer = require('./spotify-player');

class Player {

    constructor(options = {}) {
        this.logger = options.logger || console;
        this.commandRouter = options.commandRouter;
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
                item.title?.toLowerCase().includes(data.album.toLowerCase())
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
    // PLAYLIST (fix v2: via het cmd=playplaylist REST-commando,
    // dat een ander/werkend codepad gebruikt dan replaceAndPlay
    // met een 'playlists/<naam>'-uri, wat op een bekende Volumio-bug
    // stuit: /mnt/playlists/... i.p.v. het juiste /data/playlists/...)
    // -----------------------------
    async playPlaylist(data) {
 
        this.logger.info(
            `NFC Music: playlist afspelen via cmd=playplaylist: ${data.name}`
        );
 
        const response = await axios.get(
            'http://127.0.0.1:3000/api/v1/commands/',
            {
                params: {
                    cmd: 'playplaylist',
                    name: data.name
                }
            }
        );
 
        this.logger.info(
            `NFC Music: playplaylist response: ${JSON.stringify(response.data)}`
        );
 
        // Let op: deze REST-call meldt altijd "Success", zelfs als de
        // playlistnaam niet bestaat - een HTTP 200 is dus geen garantie
        // dat er ook echt iets gaat spelen. Controleer bij twijfel of
        // de queue daadwerkelijk gevuld is.
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

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'spop',
                uri: data.uri
            },
            {
                headers: { 'Content-Type': 'application/json' }
            }
        );

        this.logger.info(
            `NFC Music: Spotify gestart: HTTP ${response.status}`
        );

        return response.status === 200;
    }

}

module.exports = Player;