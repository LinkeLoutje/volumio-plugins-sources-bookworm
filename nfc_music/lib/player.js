'use strict';

const axios = require('axios');

class Player {

    constructor(options = {}) {
        this.logger = options.logger || console;
    }

// Een lokale track via Volumio MPD starten
    async playLocal(track) {

        this.logger.info(
            `NFC Music: lokale track starten: ${track.title}`
        );

        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: track.service || 'mpd',
                type: track.type || 'track',
                uri: track.uri,
                title: track.title,
                artist: track.artist,
                album: track.album,
                trackType: track.trackType
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        this.logger.info(
            `NFC Music: replaceAndPlay resultaat: HTTP ${response.status}`
        );

        return response.status === 200;
    }
// Ende lokale track spelen

// Een lokaal album zoeken en via Volumio starten
    async playLocalAlbum(artist, album) {
        // Zoek het album via de Volumio library
        const searchResponse = await axios.get(
            'http://127.0.0.1:3000/api/v1/search',
            {
                params: {
                    query: album
                }
            }
        );

        const lists = searchResponse.data?.navigation?.lists || [];

    // Zoek een album waarvan zowel artiest als album overeenkomen
        let albumItem = null;

        for (const list of lists) {
            const items = list.items || [];

            // 🔍 DEBUG: wat komt er überhaupt terug?
        for (const item of items) {
        this.logger.info(
            `CHECK: type=${item.type} | title=${item.title} | artist=${item.artist}`
        );
    }

            albumItem = items.find(item =>
                item.title &&
                item.title.toLowerCase() === album.toLowerCase()
            );

            if (albumItem) {
                this.logger.info(
                    `MATCH GEVONDEN: ${albumItem.title} | ${albumItem.uri}`
                );
                break;
            }
        }

        if (!albumItem) {
            throw new Error(`Album niet gevonden: ${artist} - ${album}`);
        }

        // Gebruik de URI die Volumio zelf heeft gevonden
        const response = await axios.post(
            'http://127.0.0.1:3000/api/v1/replaceAndPlay',
            {
                service: 'mpd',
                type: 'folder',
                uri: albumItem.uri
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.status === 200;
    }


// Einde lokaal album starten



}

module.exports = Player;
