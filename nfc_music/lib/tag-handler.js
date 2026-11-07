'use strict';

const { PluginError } = require('./errors');

/*
 * Voert één actie uit een tag uit.
 * - 'play'    -> player (album, nummer, playlist; alleen lokale bibliotheek)
 * - 'control' -> controls (play/pauze, volgende, vorige, volume)
 */
async function handleTagAction(action, player, logger, controls) {

    switch (action && action.action) {

        case 'play':
            return await handlePlay(action, player, logger);

        case 'control':
            if (!controls) {
                throw new PluginError('CONTROLS_UNAVAILABLE');
            }
            return await controls.run(action);

        default:
            throw new PluginError('UNKNOWN_ACTION', { action: action && action.action });
    }
}

async function handlePlay(action, player, logger) {

    const { type, source = 'local', data } = action;

    logger.info(
        `NFC Music: play -> type=${type}, source=${source}`
    );

    // -------------------------
    // LOCAL
    // -------------------------
    if (source === 'local') {

        switch (type) {

            case 'track':
                return await player.playTrack(data);

            case 'album':
                return await player.playAlbum(data);

            case 'playlist':
                return await player.playPlaylist(data);

            default:
                throw new PluginError('UNKNOWN_TYPE', { type });
        }
    }

    // Spotify wordt (nog) niet ondersteund: Volumio werkt alleen als Spotify
    // Connect-ontvanger en kan niet zelf een Spotify-uri starten.
    if (source === 'spotify') {
        throw new PluginError('SPOTIFY_UNSUPPORTED');
    }

    throw new PluginError('UNKNOWN_SOURCE', { source });
}

module.exports = {
    handleTagAction
};