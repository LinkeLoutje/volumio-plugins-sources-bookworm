
'use strict';

const libQ = require('kew');
const NfcReader = require('./lib/nfc-reader');
const fs = require('fs');
const path = require('path');

const Player = require('./lib/player');
const { handleTagAction } = require('./lib/tag-handler');


module.exports = NfcMusic;

// Constructor
function NfcMusic(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;

    this.config = null;
    this.nfcReader = null;
    this.player = null;
    this.tagHandler = null;
    this.tags = {};
    this.activeTag = null;
    this.lastScannedTag = null;
}

// Plugin start
NfcMusic.prototype.onStart = function () {

    this.logger.info('NFC Music: plugin starten');

    /*
     * Tags laden
     */
    const tagsFile = path.join(__dirname, 'config', 'tags.json');

    this.logger.info(
        `NFC Music: tags laden uit ${tagsFile}`
    );

    this.tags = JSON.parse(
        fs.readFileSync(tagsFile, 'utf8')
    );

    this.logger.info(
        `NFC Music: ${Object.keys(this.tags).length} tag(s) geladen`
    );

    /*
     * Player initialiseren
     */
    this.player = new Player({
        logger: this.logger,
        commandRouter: this.commandRouter
    });

    /*
     * Tag handler initialiseren --> Verwijderd ivm refactor (Hint voor wanneer foutief. Later comment verwijderen.)
     */


    /*
     * NFC reader initialiseren
     */
    this.nfcReader = new NfcReader({

        logger: this.logger,

        onTag: async (uid) => {

            this.logger.info(
                `NFC Music: tag ontvangen: ${uid}`
            );

            try {

                    const tag = this.tags[uid];

                    if (!tag) {
                        this.logger.warn(`NFC Music: onbekende tag: ${uid}`);
                        return;
                    }

                    for (const action of tag.actions) {
                        await handleTagAction(action, this.player, this.logger);
                    }

            } catch (error) {

                this.logger.error(
                    `NFC Music: tag verwerken mislukt: ${error.message}`
                );

            }
        }
    });

    this.nfcReader.start();

    this.logger.info(
        'NFC Music: NFC reader geïnitialiseerd'
    );

    return libQ.resolve();
};

// ONSTOP
NfcMusic.prototype.onStop = function () {

    this.logger.info(
        'NFC Music: TEST pcsclite stoppen'
    );

    this.logger.info(
        'NFC Music: pcsc.close() wordt NIET uitgevoerd'
    );

    this.pcsc = null;

    return libQ.resolve();
};

// Plugin restart
NfcMusic.prototype.onRestart = function () {

    this.logger.info('NFC Music: plugin herstart');

};

// Plugin UI
NfcMusic.prototype.getUIConfig = function () {
    const defer = libQ.defer();
    const tags = this.tags || {};
    const tagKeys = Object.keys(tags);

    //temp logging
    this.logger.info("TAGS DEBUG: " + JSON.stringify(tags));
    this.logger.info("TAG KEYS: " + JSON.stringify(Object.keys(tags || {})));


    this.commandRouter.i18nJson(
        __dirname + '/i18n/strings_en.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )

    .then(uiconf => {

        const tags = this.tags || {};
        const tagKeys = Object.keys(tags);

        const section = uiconf.sections.find(s => s.id === "tags");

        if (!section) {
            this.logger.error("tags section niet gevonden");
            defer.resolve(uiconf);
            return;
        }

        section.content = [
            {
                id: "last_scanned",
                element: "label",
                value: "Last scanned: " + (this.lastScannedTag || "none")
            },
            {
                id: "active_tag",
                element: "select",
                label: "Select tag",
                value: this.activeTag || "",
                options: tagKeys.map(uid => ({
                    value: uid,
                    label: tags[uid].name || uid
                }))
            }
        ];

        this.logger.info("UI opgebouwd (basic)");

        defer.resolve(uiconf);
    })

    .fail(err => {
        this.logger.error("UI ERROR " + err);
        defer.reject(err);
    });

    return defer.promise;
};
// Toevoegen executeTag en playLocal en playSpotify voor UI tag functionaliteit
NfcMusic.prototype.executeTag = function (tag) {
    this.logger.info('NFC Music: executing tag ' + JSON.stringify(tag));

    if (!tag || !tag.actions || tag.actions.length === 0) {
        this.logger.error('Tag heeft geen actions');
        return;
    }

    const action = tag.actions[0]; // later uitbreidbaar

    switch (action.action) {

        case 'play':
            return this.playLocal(action);

        case 'playSpotify':
            return this.playSpotify(action);

        default:
            this.logger.error('Unknown action: ' + action.action);
    }
};
NfcMusic.prototype.playLocal = function (action) {
    const data = action.data || {};

    this.logger.info('Playing local: ' + JSON.stringify(data));

    if (action.type === 'playlist') {
        return this.commandRouter.volumioReplaceandPlayItems({
            service: 'mpd',
            type: 'playlist',
            name: data.name
        });
    }

    if (action.type === 'album') {
        return this.commandRouter.volumioReplaceandPlayItems({
            service: 'mpd',
            type: 'album',
            artist: data.artist,
            album: data.album
        });
    }
};
NfcMusic.prototype.playSpotify = function (action) {
    this.logger.info('Spotify play: ' + action.uri);

    return this.commandRouter.executeOnPlugin(
        'music_service',
        'spotify',
        'playUri',
        action.uri
    );
};
// UI endpoint handler
NfcMusic.prototype.playTag = function (data) {
    const uid = data;

    const tag = this.tags[uid];

    if (!tag) {
        this.logger.error('Tag niet gevonden: ' + uid);
        return;
    }

    return this.executeTag(tag);
};


NfcMusic.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

NfcMusic.prototype.setUIConfig = function (data) {
};

NfcMusic.prototype.getConf = function (varName) {
    return this.config.get(varName);
};

NfcMusic.prototype.setConf = function (varName, varValue) {
    this.config.set(varName, varValue);
};
