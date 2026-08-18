'use strict';

async function handleTagAction(action, player, logger) {

    switch (action.action) {

        case 'play':
            await handlePlay(action, player, logger);
            break;

        case 'pause':
            await player.pause?.();
            break;

        case 'next':
            await player.next?.();
            break;

        case 'previous':
            await player.previous?.();
            break;

        default:
            throw new Error(`Onbekende action: ${action.action}`);
    }
}

async function handlePlay(action, player, logger) {

    const { type, source = 'local', data } = action;

    logger.info(`NFC Music: play request -> type=${type}, source=${source}`);

    switch (type) {

        case 'track':
            return await player.playTrack
                ? player.playTrack(data)
                : player.playLocal(data);

        case 'album':
            return await player.playAlbum(data);

        case 'playlist':
            return await player.playPlaylist(data);

        default:
            throw new Error(`Onbekend type: ${type}`);
    }
}

module.exports = {
    handleTagAction
};