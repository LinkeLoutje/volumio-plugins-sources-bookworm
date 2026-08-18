'use strict';

function createTagHandler(options = {}) {

    const player = options.player;
    const logger = options.logger || console;
    const tags = options.tags || {};

    async function handleTag(uid) {

        const tag = tags[uid];

        if (!tag) {
            logger.info(
                `NFC Music: onbekende tag: ${uid}`
            );
            return;
        }

        logger.info(
            `NFC Music: tag "${tag.name}" gevonden`
        );

        if (!Array.isArray(tag.actions)) {
            throw new Error(
                `Geen actions gedefinieerd voor tag ${uid}`
            );
        }

        for (const action of tag.actions) {

            logger.info(
                `NFC Music: actie: ${action.action}`
            );

            switch (action.action) {

                case 'playLocal':
                    await player.playLocal(action);
                    break;

                case 'playLocalAlbum':
                    await player.playLocalAlbum(
                        action.artist,
                        action.album
                    );
                    break;

                default:
                    throw new Error(
                        `Onbekende action: ${action.action}`
                    );
            }
        }
    }

    return {
        handleTag
    };
}

module.exports = createTagHandler;
