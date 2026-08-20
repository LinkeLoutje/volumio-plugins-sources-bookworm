'use strict';

const libQ = require('kew');
const NfcReader = require('./lib/nfc-reader');
const fs = require('fs');
const path = require('path');

const Player = require('./lib/player');
const { handleTagAction } = require('./lib/tag-handler');


module.exports = NfcMusic;

// =========================================================
// Constructor
// =========================================================
function NfcMusic(context) {
    this.context = context;
    this.commandRouter = context.coreCommand;
    this.logger = context.logger;
    this.configManager = context.configManager;

    this.config = null;
    this.nfcReader = null;
    this.player = null;
    this.tags = {}; // persisted
    this.activeTag = null;
    this.activeEditTag = null;
    this.scannedTags = {}; //runtime (non-persisted)

    this.uiBusy = false; // prevent double UI refreshes
}

// =========================================================
// HELPERS (internal plugin functions)
// =========================================================


/*
 * LOAD TAGS
 * ---------------------------------------------------------
 * Laadt de tags.json file in het geheugen
 */
NfcMusic.prototype.loadTags = function () {

    const tagsFile = path.join(__dirname, 'config', 'tags.json');

    try {
        this.logger.info(`NFC Music: tags laden uit ${tagsFile}`);

        const raw = fs.readFileSync(tagsFile, 'utf8');
        this.tags = raw ? JSON.parse(raw) : {};

        this.logger.info(
            `NFC Music: ${Object.keys(this.tags).length} tag(s) geladen`
        );

    } catch (e) {
        this.logger.error(`tags.json read error: ${e}`);
        this.tags = {};
    }
};

/*
 * TAG STORAGE (atomic persist to disk)
 * ---------------------------------------------------------
 * Slaat de tags.json file op met de huidige tag configuratie
 */
NfcMusic.prototype.saveTags = function () {

    const dir = path.join(__dirname, 'config');
    const file = path.join(dir, 'tags.json');
    const tmp = path.join(dir, 'tags.json.tmp');

    try {

        // safety check
        if (!this.tags || typeof this.tags !== 'object') {
            this.logger.error('Invalid tags structure, not saving');
            return;
        }

        // 1. serialize
        const json = JSON.stringify(this.tags, null, 2);

        // 2. write temp file
        fs.writeFileSync(tmp, json, 'utf8');

        // 3. backup (optional)
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, file + '.bak');
        }

        // 4. atomic replace
        fs.renameSync(tmp, file);

        this.logger.info('NFC Music: tags opgeslagen');

    } catch (e) {

        this.logger.error('tags.json write error: ' + e);

        // cleanup temp file als iets faalt
        try {
            if (fs.existsSync(tmp)) {
                fs.unlinkSync(tmp);
            }
        } catch (cleanupErr) {
            this.logger.warn('temp cleanup failed: ' + cleanupErr);
        }
    }
};

/*
 * Refresh UI
 * ---------------------------------------------------------
 * Ververst de UI-config en stuurt deze naar de frontend
 */
NfcMusic.prototype.refreshUI = function () {
    const router = this.commandRouter;

    return new Promise((resolve) => {
        router.getUIConfigOnPlugin(
            'system_hardware',
            'nfc_music',
            {}
        ).then(config => {
            this.uiBusy = false;
            router.broadcastMessage('pushUiConfig', config);
            resolve();
        }).fail(err => {
            this.uiBusy = false;
            this.logger.error('UI refresh failed: ' + err);
            resolve();
        });
    });
};

// =========================================================
// Plugin Start Lifecycle
// =========================================================
NfcMusic.prototype.onStart = function () {

    this.logger.info('NFC Music: plugin starten');

    // =========================================================
    // 1. TAG STORAGE INITIALISATIE (persisted state)
    // =========================================================

    const tagsFile = path.join(__dirname, 'config', 'tags.json');

    this.logger.info(
        `NFC Music: tags laden uit ${tagsFile}`
    );

    this.loadTags();

    this.logger.info(
        `NFC Music: ${Object.keys(this.tags).length} tag(s) geladen`
    );


    // =========================================================
    // 2. PLAYER INITIALISATIE (playback engine wrapper)
    // =========================================================

    this.player = new Player({
        logger: this.logger,
        commandRouter: this.commandRouter
    });


    // =========================================================
    // 3. TAG HANDLER (LOGICA LAYER - tijdelijk verwijderd)
    // =========================================================

    /*
     * Tag handler (refactor fase)
     * -> later verplaatsen naar /lib/tag-handler.js
     */


    // =========================================================
    // 4. NFC READER INITIALISATIE (hardware / event source)
    // =========================================================

    this.nfcReader = new NfcReader({

        logger: this.logger,

        onTag: async (uid) => {

            this.logger.info(`NFC Music: tag ontvangen: ${uid}`);

            // =================================================
            // 4.1.1 STATE UPDATE
            // =================================================

            this.activeTag = uid;

            // optioneel: runtime cache (voor UI edit flow later)
            this.scannedTags[uid] = this.tags[uid] || {
                name: `Onbekende tag (${uid})`,
                actions: []
            };

            // =================================================
            // 4.1.2 PLAYBACK ENGINE
            // =================================================

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
                this.logger.error(`NFC Music: tag verwerken mislukt: ${error.message}`);
            }

            // =================================================
            // 4.1.3 UI REFRESH
            // =================================================

            return this.refreshUI();
        }
    });


    // =========================================================
    // 5. NFC START (hardware activation)
    // =========================================================

    this.nfcReader.start();

    this.logger.info(
        'NFC Music: NFC reader geïnitialiseerd'
    );

    return libQ.resolve();
};

// =====================================================
// onStop (plugin stop lifecycle)
// =====================================================
NfcMusic.prototype.onStop = function () {

    this.logger.info('NFC Music: stopping plugin');

    // =====================================================
    // 1. NFC READER STOP
    // =====================================================

    if (this.nfcReader) {
        try {
            this.nfcReader.stop();
            this.logger.info('NFC Music: NFC reader gestopt');
        } catch (e) {
            this.logger.error('NFC Music: error stopping reader ' + e);
        }
    }

    this.nfcReader = null;

    // =====================================================
    // 2. RUNTIME STATE RESET
    // =====================================================

    this.activeTag = null;
    this.scannedTags = {};

    // =====================================================
    // 3. PLAYER CLEANUP (optioneel maar netjes)
    // =====================================================

    if (this.player && this.player.stop) {
        try {
            this.player.stop();
        } catch (e) {
            this.logger.error('Player stop error ' + e);
        }
    }

    this.player = null;

    return libQ.resolve();
};

// =====================================================
// Plugin restart lifecycle
// =====================================================
NfcMusic.prototype.onRestart = function () {

    this.logger.info('NFC Music: plugin herstart');

    // Herstart = zelfde als stop/start cycle light
    this.activeTag = null;
    this.scannedTags = {};

    return libQ.resolve();
};

// =====================================================
// Plugin UI
// =====================================================
NfcMusic.prototype.getUIConfig = function () {
    const defer = libQ.defer();

    this.logger.info(`ACTIVE TAG (UI): ${this.activeTag}`);

    let tags = this.tags;

    // include runtime scanned tags only if needed
    const scannedKeys = Object.keys(this.scannedTags || {});

    if (scannedKeys.length > 0) {
        tags = {
            ...this.tags,
            ...this.scannedTags
        };
    }

    const tagKeys = Object.keys(tags);
    const editingUid = this.activeEditTag;

    this.commandRouter.i18nJson(
        __dirname + '/i18n/strings_en.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    )
    .then(uiconf => {

        const section = uiconf.sections.find(s => s.id === "tags");

        if (!section) {
            this.logger.error("tags section niet gevonden");
            defer.resolve(uiconf);
            return;
        }

        /*
        // Edit mode: show tag editor if a tag is being edited
        */
        if (editingUid && tags[editingUid]) {

            const tag = tags[editingUid];

            section.content = [
                // 👇 FORM (alleen voor data binding, NIET voor UI)
                {
                    element: "form",
                    id: "tagForm",
                    content: [
                        { id: "name", element: "input", value: tag.name || "" },
                        { id: "type", element: "input", value: tag.actions?.[0]?.type || "album" },
                        { id: "artist", element: "input", value: tag.actions?.[0]?.data?.artist || "" },
                        { id: "album", element: "input", value: tag.actions?.[0]?.data?.album || "" }
                    ]
                },

                // 👇 ZICHTBARE UI (los van form)
                {
                    element: "label",
                    value: `Tag: ${editingUid}`
                },
                {
                    id: "name",
                    element: "input",
                    label: "Naam",
                    value: tag.name || ""
                },
                {
                    id: "type",
                    element: "select",
                    label: "Type",
                    value: tag.actions?.[0]?.type || "album",
                    options: [
                        { value: "album", label: "Album" },
                        { value: "playlist", label: "Playlist" },
                        { value: "spotify", label: "Spotify" }
                    ]
                },
                {
                    id: "artist",
                    element: "input",
                    label: "Artist",
                    value: tag.actions?.[0]?.data?.artist || ""
                },
                {
                    id: "album",
                    element: "input",
                    label: "Album / Playlist",
                    value: tag.actions?.[0]?.data?.album || ""
                },

                {
                    element: "button",
                    label: "Save",
                    onClick: {
                        type: "controller",
                        endpoint: "system_hardware/nfc_music",
                        method: "saveTag",
                        data: {
                            name: "$name",
                            type: "$type",
                            artist: "$artist",
                            album: "album"
                        }
                    }
                },
                {
                    element: "button",
                    label: "Annuleren",
                    onClick: {
                        type: "controller",
                        endpoint: "system_hardware/nfc_music",
                        method: "closeTagEditor"
                    }
                }
            ];
            this.logger.info(`UI in EDIT MODE voor ${editingUid}`);
        }

        /*
        // List mode: show all tags with edit buttons
        */
        else {
            section.content = tagKeys.map(uid => ({
                id: uid,
                element: "button",
                label: `✏️ Edit: ${tags[uid].name || uid}`,
                value: uid,
                onClick: {
                    type: "controller",
                    endpoint: "system_hardware/nfc_music",
                    method: "openTagEditor",
                    data: { uid }
                }
            }));

            this.logger.info(`UI in LIST MODE (${tagKeys.length} tags)`);
        }

        defer.resolve(uiconf);
    })
    .fail(err => {
        this.logger.error("UI ERROR " + err);
        defer.reject(err);
    });

    return defer.promise;
};

// =========================================================
// TAG EXECUTION LAYER (core playback logic)
// =========================================================

/*
 * executeTag()
 * ---------------------------------------------------------
 * Entry point voor een gescande tag.
 * - ontvangt een volledige tag object
 * - kiest welke actie(s) uitgevoerd worden
 * - dispatch naar playback handlers
 */
NfcMusic.prototype.executeTag = function (tag) {

    this.logger.info(
        'NFC Music: executing tag ' + JSON.stringify(tag)
    );

    // -----------------------------------------------------
    // VALIDATIE: tag moet acties bevatten
    // -----------------------------------------------------
    if (!tag || !tag.actions || tag.actions.length === 0) {
        this.logger.error('Tag heeft geen actions');
        return;
    }

    // -----------------------------------------------------
    // ACTIE SELECTIE (nu: alleen eerste actie)
    // TODO: later uitbreiden naar multi-action flow
    // -----------------------------------------------------
    const action = tag.actions[0];

    // -----------------------------------------------------
    // DISPATCHER: route action naar juiste handler
    // -----------------------------------------------------
    switch (action.action) {

        case 'play':
            return this.playLocal(action);

        case 'playSpotify':
            return this.playSpotify(action);

        default:
            this.logger.error(
                'Unknown action: ' + action.action
            );
    }
};


// =========================================================
// PLAYBACK HANDLER: LOCAL (MPD / Volumio library)
// =========================================================

/*
 * playLocal()
 * ---------------------------------------------------------
 * Handelt lokale playback acties af:
 * - album
 * - playlist
 */
NfcMusic.prototype.playLocal = function (action) {

    const data = action.data || {};

    this.logger.info(
        'NFC Music: Playing local -> ' + JSON.stringify(data)
    );

    // -----------------------------------------------------
    // PLAYLIST HANDLING
    // -----------------------------------------------------
    if (action.type === 'playlist') {

        return this.commandRouter.volumioReplaceandPlayItems({
            service: 'mpd',
            type: 'playlist',
            name: data.name
        });
    }

    // -----------------------------------------------------
    // ALBUM HANDLING
    // -----------------------------------------------------
    if (action.type === 'album') {

        return this.commandRouter.volumioReplaceandPlayItems({
            service: 'mpd',
            type: 'album',
            artist: data.artist,
            album: data.album
        });
    }

    this.logger.warn(
        'playLocal: onbekend type ' + action.type
    );
};


// =========================================================
// PLAYBACK HANDLER: SPOTIFY
// =========================================================

/*
 * playSpotify()
 * ---------------------------------------------------------
 * Stuurt Spotify URI naar Volumio Spotify plugin
 */
NfcMusic.prototype.playSpotify = function (action) {

    this.logger.info(
        'NFC Music: Spotify play -> ' + action.uri
    );

    return this.commandRouter.executeOnPlugin(
        'music_service',
        'spotify',
        'playUri',
        action.uri
    );
};


// =========================================================
// UI ACTION HANDLERS (called from frontend buttons)
// =========================================================

/*
 * getConfigurationFiles()
 * ---------------------------------------------------------
 * Definieert welke config files Volumio moet laden
 */
NfcMusic.prototype.getConfigurationFiles = function () {
    return ['config.json'];
};

/*
 * openTagEditor()
 * ---------------------------------------------------------
 * Opent de tag editor voor een specifieke NFC tag
 */
NfcMusic.prototype.openTagEditor = function (data) {

    const uid = data?.uid;

    this.logger.info(`NFC Music: openTagEditor -> ${uid}`);

    this.activeEditTag = uid;

    return this.refreshUI();
};

/*
 * saveTag()
 * ---------------------------------------------------------
 * Slaat de gewijzigde taggegevens op vanuit UI editor
 */
NfcMusic.prototype.saveTag = async function (data) {

    const uid = this.activeEditTag;

    // =====================================================
    // DEBUG LOGGING
    // =====================================================

    this.logger.info(`saveTag: ${uid}`);
    this.logger.info(`saveTag data: ${JSON.stringify(data)}`);
    
    // Extra, duidelijker dan boven: log type en inhoud apart
    this.logger.info('saveTag RAW data type: ' + typeof data);
    this.logger.info('saveTag RAW data: ' + data);

    try {
        this.logger.info('saveTag JSON: ' + JSON.stringify(data, null, 2));
    } catch (e) {
        this.logger.warn('saveTag JSON stringify failed');
    }

    // Keys loggen
    if (data && typeof data === 'object') {
        this.logger.info('saveTag keys: ' + Object.keys(data).join(', '));
    }

    // Full argument
    this.logger.info('FULL ARGUMENTS: ' + JSON.stringify(arguments));

    // =====================================================
    // 1. UI LOCK (voorkomt dubbele saves / race conditions)
    // =====================================================

    if (this.uiBusy) {
        this.logger.warn('saveTag blocked (UI busy)');
        return;
    }

    this.uiBusy = true;

    try {

        // =================================================
        // 2. VALIDATIE: UID aanwezig
        // =================================================

        if (!uid) {
            throw new Error('saveTag: geen activeEditTag');
        }

        // =================================================
        // 3. VALIDATIE: data aanwezig
        // =================================================

        if (!data) {
            throw new Error('saveTag: geen data ontvangen');
        }

        // =================================================
        // 3.1 Volumio FIX: data kan string zijn
        // =================================================

        if (typeof data === 'string') {
            if (data === 'data') {
                this.logger.error('saveTag: UI stuurde placeholder string i.p.v. form data');
                this.uiBusy = false;
                return;
            }

            try {
                data = JSON.parse(data);
            } catch (e) {
                this.logger.warn('saveTag: invalid JSON payload');
                data = {};
            }
        }

        // =================================================
        // 4. Zorg dat tag bestaat
        // =================================================

        if (!this.tags[uid]) {
            this.logger.info(`saveTag: nieuwe tag aangemaakt (${uid})`);

            this.tags[uid] = {
                name: uid,
                actions: []
            };
        }

        // =================================================
        // 5. UPDATE MODEL (TAG DATA STRUCTURE)
        // =================================================

        this.tags[uid].name = data.name || uid;

        this.tags[uid].actions = [{
            action: data.type === "spotify" ? "playSpotify" : "play",
            type: data.type || "album",
            data: {
                artist: data.artist || "",
                album: data.album || ""
            }
        }];

        // =================================================
        // 6. PERSIST TO DISK
        // =================================================

        this.saveTags();

        // =================================================
        // 7. EXIT EDIT MODE
        // =================================================

        this.activeEditTag = null;

        // =================================================
        // 8. REFRESH UI (CENTRALE WRAPPER)
        // =================================================

        await this.refreshUI();

    } catch (err) {

        this.logger.error('saveTag error: ' + err);

    } finally {

        // =================================================
        // 9. ALWAYS UNLOCK UI
        // =================================================

        this.uiBusy = false;
    }
};

/*
 * closeTagEditor()
 * ---------------------------------------------------------
 * Sluit de tag editor
 */
NfcMusic.prototype.closeTagEditor = function () {

    this.logger.info('NFC Music: closeTagEditor');

    // reset edit state
    this.activeEditTag = null;

    // UI opnieuw laden
    return this.refreshUI();
};


// =========================================================
// UI CONFIG HANDLING (future use)
// =========================================================

/*
 * setUIConfig()
 * ---------------------------------------------------------
 * Wordt aangeroepen bij UI save actions
 * (nu nog niet geïmplementeerd)
 */
NfcMusic.prototype.setUIConfig = function (data) {
    // TODO: UI save / tag editing logic
};


// =========================================================
// CONFIG GETTER / SETTER WRAPPER
// =========================================================

/*
 * getConf()
 * ---------------------------------------------------------
 * Haalt plugin config waarde op
 */
NfcMusic.prototype.getConf = function (varName) {
    return this.config.get(varName);
};


/*
 * setConf()
 * ---------------------------------------------------------
 * Schrijft plugin config waarde weg
 */
NfcMusic.prototype.setConf = function (varName, varValue) {
    this.config.set(varName, varValue);
};