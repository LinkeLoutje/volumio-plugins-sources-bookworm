'use strict';

const libQ = require('kew');
const NfcReader = require('./lib/nfc-reader');
const fs = require('fs');
const path = require('path');

const Player = require('./lib/player');
const Controls = require('./lib/controls');
const { handleTagAction } = require('./lib/tag-handler');
const { createTranslator } = require('./lib/i18n');

const ENDPOINT = 'system_hardware/nfc_music';
// Zelfde tag binnen deze tijd = dubbel event van pcsclite (status flikkert).
const SCAN_DEBOUNCE_MS = 1200;


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
    this.controls = null;
    this.lastScan = { uid: null, at: 0 };
    this.translator = null;
    this.running = false;   // true tussen onStart en onStop
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
NfcMusic.prototype.getTagsDir = function () {
    // /data/configuration/system_hardware/nfc_music - blijft staan bij een
    // plugin-update of herinstallatie (de pluginmap zelf wordt dan vervangen).
    const configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
    return path.dirname(configFile);
};

NfcMusic.prototype.getTagsFile = function () {
    return path.join(this.getTagsDir(), 'tags.json');
};

/*
 * Eenmalige migratie: tags.json uit de oude locatie (pluginmap/config)
 * overzetten naar de configuratiemap.
 *
 * Werkt alleen bij `volumio plugin refresh` (kopieert over de bestaande map heen).
 * Bij een update via de store/zip vervangt Volumio de pluginmap vóór onStart,
 * dan is het oude bestand al weg. Geen probleem: geen enkele store-versie heeft
 * de oude locatie gebruikt; dit is alleen voor bestaande ontwikkel-installaties.
 */
NfcMusic.prototype.migrateTagsFile = function () {
    const oldFile = path.join(__dirname, 'config', 'tags.json');
    const newFile = this.getTagsFile();

    try {
        if (!fs.existsSync(newFile) && fs.existsSync(oldFile)) {
            fs.mkdirSync(path.dirname(newFile), { recursive: true });
            fs.copyFileSync(oldFile, newFile);
            this.logger.info(`NFC Music: tags.json migrated to ${newFile}`);
        }
    } catch (e) {
        this.logger.error(`NFC Music: migrating tags.json failed: ${e}`);
    }
};

NfcMusic.prototype.loadTags = function () {

    const tagsFile = this.getTagsFile();

    if (!fs.existsSync(tagsFile)) {
        this.logger.info('NFC Music: no tags.json yet, starting with an empty list');
        this.tags = {};
        return;
    }

    try {
        this.logger.info(`NFC Music: loading tags from ${tagsFile}`);

        const raw = fs.readFileSync(tagsFile, 'utf8');
        this.tags = raw ? JSON.parse(raw) : {};

        this.logger.info(
            `NFC Music: ${Object.keys(this.tags).length} tag(s) loaded`
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

    const dir = this.getTagsDir();
    const file = this.getTagsFile();
    const tmp = path.join(dir, 'tags.json.tmp');

    try {

        // safety check
        if (!this.tags || typeof this.tags !== 'object') {
            this.logger.error('Invalid tags structure, not saving');
            return;
        }

        fs.mkdirSync(dir, { recursive: true });

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

        this.logger.info('NFC Music: tags saved');

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

    this.logger.info('NFC Music: starting plugin');

    // =========================================================
    // 1. TAG STORAGE INITIALISATIE (persisted state)
    // =========================================================

    this.migrateTagsFile();
    this.loadTags();


    // =========================================================
    // 2. PLAYER INITIALISATIE (playback engine wrapper)
    // =========================================================

    this.player = new Player({
        logger: this.logger,
        commandRouter: this.commandRouter
    });

    this.controls = new Controls(this.commandRouter, this.logger);
    this.running = true;


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

        // Alles rond een scan (debounce, acties, UI verversen) staat in handleScan.
        onTag: (uid) => this.handleScan(uid)
    });


    // =========================================================
    // 5. NFC START (hardware activation)
    // =========================================================

    this.nfcReader.start();

    this.logger.info(
        'NFC Music: NFC reader initialised'
    );

    return libQ.resolve();
};

// =========================================================
// SCAN AFHANDELEN
// =========================================================
NfcMusic.prototype.handleScan = async function (uid) {
    const now = Date.now();

    // Vangnet: een gestopte instantie (oude plugin na herstart) of een lege UID
    // mag niets doen.
    if (!this.running) {
        this.logger.info(`NFC Music: scan ignored, plugin is stopped: ${uid}`);
        return;
    }
    if (typeof uid !== 'string' || uid.length === 0) {
        this.logger.error('NFC Music: scan without UID ignored');
        return;
    }

    // pcsclite meldt een kaart soms twee keer kort na elkaar. De reader meldt
    // alleen de overgang naar 'aanwezig', dus een kaart die blijft liggen
    // vuurt niet opnieuw; weghalen en terugleggen wel.
    if (uid === this.lastScan.uid && now - this.lastScan.at < SCAN_DEBOUNCE_MS) {
        this.logger.info(`NFC Music: duplicate scan ignored: ${uid}`);
        return;
    }
    this.lastScan = { uid: uid, at: now };

    this.logger.info(`NFC Music: tag received: ${uid}`);
    this.activeTag = uid;
    this.scannedTags[uid] = this.tags[uid] || { name: uid, actions: [] };

    try {
        const tag = this.tags[uid];

        if (!tag || !Array.isArray(tag.actions) || tag.actions.length === 0) {
            this.logger.warn(`NFC Music: unknown tag: ${uid}`);
            this.commandRouter.pushToastMessage('info', 'NFC Music', this.t('TOAST_NEW_TAG', { uid: uid }));
            return;
        }

        for (const action of tag.actions) {
            try {
                await handleTagAction(action, this.player, this.logger, this.controls);
            } catch (error) {
                this.logger.error(`NFC Music: action failed for ${uid}: ${error.message}`);
                this.commandRouter.pushToastMessage('error', 'NFC Music',
                    this.t('TOAST_ACTION_FAILED', { name: tag.name || uid, error: this.errorText(error) }));
            }
        }
    } finally {
        // Altijd verversen, ook bij een onbekende tag of een mislukte actie,
        // zodat 'Laatst gescande tag' op de configuratiepagina klopt.
        await this.refreshUI();
    }
};

/*
 * Vertaling voor teksten die in index.js worden opgebouwd. De taal wordt
 * elke keer opgevraagd, zodat een taalwissel in Volumio direct werkt.
 */
NfcMusic.prototype.t = function (key, vars) {
    const lang = (this.commandRouter.sharedVars && this.commandRouter.sharedVars.get('language_code')) || 'en';
    if (!this.translator || this.translator.lang !== lang) {
        this.translator = { lang: lang, t: createTranslator(path.join(__dirname, 'i18n'), lang) };
    }
    return this.translator.t(key, vars);
};

/*
 * Foutmelding voor de gebruiker: fouten met een code (PluginError) in de
 * taal van de gebruiker, andere fouten met hun eigen tekst.
 */
NfcMusic.prototype.errorText = function (error) {
    if (error && error.code) {
        return this.t('ERR_' + error.code, error.params);
    }
    return (error && error.message) || String(error);
};

// =====================================================
// onStop (plugin stop lifecycle)
// =====================================================
NfcMusic.prototype.onStop = function () {

    this.logger.info('NFC Music: stopping plugin');
    this.running = false;

    // =====================================================
    // 1. NFC READER STOP
    // =====================================================

    if (this.nfcReader) {
        try {
            this.nfcReader.stop();
            this.logger.info('NFC Music: NFC reader stopped');
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
    this.lastScan = { uid: null, at: 0 };
    this.controls = null;

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

    this.logger.info('NFC Music: plugin restart');

    // Herstart = zelfde als stop/start cycle light
    this.activeTag = null;
    this.scannedTags = {};

    return libQ.resolve();
};

// ===========================================================
// UI CONFIGURATIE (dynamisch opgebouwd)
// ===========================================================

NfcMusic.prototype.getUIConfig = function () {
    var self = this;
    var defer = libQ.defer();

    var lang_code = self.commandRouter.sharedVars.get('language_code');

    self.commandRouter.i18nJson(
        __dirname + '/i18n/strings_' + lang_code + '.json',
        __dirname + '/i18n/strings_en.json',
        __dirname + '/UIConfig.json'
    ).then(function (uiconf) {

        var sectionLastScanned = uiconf.sections[0];
        var sectionPickExisting = uiconf.sections[1];
        var sectionEditTag = uiconf.sections[2];

        self.buildLastScannedSection(sectionLastScanned);
        self.buildPickExistingSection(sectionPickExisting);
        self.buildEditTagSection(sectionEditTag);

        defer.resolve(uiconf);

    }).fail(function (error) {
        self.logger.error('NFC Music: getUIConfig failed: ' + error);
        defer.reject(new Error());
    });

    return defer.promise;
};


// -----------------------------------------------------------
// Sectie 1: laatst gescande tag
// -----------------------------------------------------------
NfcMusic.prototype.buildLastScannedSection = function (section) {
    var self = this;
    var uid = self.activeTag;


    if (!uid) {
        section.content.push({
            id: 'last_scanned_info',
            element: 'input', type: 'text',
            label: self.t('FIELD_STATUS'),
            value: self.t('LAST_SCANNED_NONE')
        });
        return;
    }

    var existing = self.tags[uid];

    section.content.push({
        id: 'last_scanned_uid',
        element: 'input', type: 'text',
        label: self.t('FIELD_UID'),
        value: uid
    });

    section.content.push({
        id: 'last_scanned_name',
        element: 'input', type: 'text',
        label: self.t('FIELD_NAME'),
        value: existing ? existing.name : self.t('LAST_SCANNED_NEW')
    });

    section.content.push({
        id: 'edit_last_scanned_button',
        element: 'button',
        label: self.t('BUTTON_EDIT_THIS_TAG'),
        onClick: {
            type: 'controller',
            endpoint: ENDPOINT,
            method: 'editLastScanned'
        }
    });
};


// -----------------------------------------------------------
// Sectie 2: bestaande tag kiezen
// -----------------------------------------------------------
NfcMusic.prototype.buildPickExistingSection = function (section) {
    var self = this;

    var entries = Object.keys(self.tags).map(function (uid) {
        return { uid: uid, name: self.tags[uid].name || uid };
    });

    if (entries.length === 0) {
        section.content.push({
            id: 'no_existing_tags',
            element: 'input', type: 'text',
            label: self.t('FIELD_INFO'),
            value: self.t('NO_TAGS')
        });
        return;
    }

    entries.sort(function (a, b) {
        return a.name.localeCompare(b.name);
    });

    var options = entries.map(function (e) {
        return { value: e.uid, label: e.name + ' (' + e.uid + ')' };
    });

    var defaultOption = self.activeEditTag
        ? options.find(function (o) { return o.value === self.activeEditTag; })
        : null;

    section.content.push({
        id: 'existingTagUid',
        element: 'select',
        label: self.t('FIELD_TAG'),
        value: defaultOption || options[0],
        options: options
    });
};


// -----------------------------------------------------------
// Sectie 3: tag bewerken
// -----------------------------------------------------------
NfcMusic.prototype.buildEditTagSection = function (section) {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        section.content.push({
            id: 'edit_tag_info',
            element: 'input', type: 'text',
            label: self.t('FIELD_INFO'),
            value: self.t('EDIT_TAG_NONE')
        });
        return;
    }

    var tag = self.tags[uid] || { name: uid, actions: [] };
    var firstAction = tag.actions && tag.actions[0] ? tag.actions[0] : null;
    var actionKey = self.combinedActionTypeKey(firstAction);
    var actionData = (firstAction && firstAction.data) ? firstAction.data : {};

    var actionTypeOptions = [
        { value: 'local_track', label: self.t('ACTION_LOCAL_TRACK') },
        { value: 'local_album', label: self.t('ACTION_LOCAL_ALBUM') }
        // Lokale afspeellijsten zijn verborgen tot ze betrouwbaar werken (nieuwe functie).
        // Bestaande playlist-tags in tags.json blijven gewoon afspelen.
    ].concat(Controls.COMMANDS.map(function (command) {
        return { value: 'control_' + command, label: self.t('ACTION_CONTROL_' + command.toUpperCase()) };
    }));

    section.content.push({
        id: 'edit_tag_uid',
        element: 'input', type: 'text',
        label: self.t('FIELD_UID'),
        value: uid
    });

    section.content.push({
        id: 'name',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_NAME'),
        value: tag.name || uid
    });

    section.content.push({
        id: 'actionType',
        element: 'select',
        label: self.t('FIELD_ACTION_TYPE'),
        value: actionTypeOptions.find(function (o) { return o.value === actionKey; }) || actionTypeOptions[1],
        options: actionTypeOptions
    });

    // --- Lokaal: los nummer ---
    section.content.push({
        id: 'track_titel',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_TRACK_TITLE'),
        doc: self.t('FIELD_TRACK_TITLE_DOC'),
        value: actionData.title || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
    section.content.push({
        id: 'track_artist',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_ARTIST'),
        value: actionData.artist || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
    section.content.push({
        id: 'track_album',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_ALBUM_OPTIONAL'),
        value: actionData.album || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });
/* track_uri niet meer nodig ivm search in player.js, maar kan nog wel gebruikt worden als fallback */
    section.content.push({
        id: 'track_uri',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_TRACK_URI'),
        doc: self.t('FIELD_TRACK_URI_DOC'),
        value: actionData.uri || '',
        visibleIf: { field: 'actionType', value: 'local_track' }
    });

    // --- Lokaal: album ---
    section.content.push({
        id: 'album_artist',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_ARTIST'),
        value: actionKey === 'local_album' ? (actionData.artist || '') : '',
        visibleIf: { field: 'actionType', value: 'local_album' }
    });
    section.content.push({
        id: 'album_naam',
        element: 'input',
        type: 'text',
        label: self.t('FIELD_ALBUM_NAME'),
        value: actionKey === 'local_album' ? (actionData.album || '') : '',
        visibleIf: { field: 'actionType', value: 'local_album' }
    });

    // --- Bediening ---
    var controlData = actionKey.indexOf('control_') === 0 ? actionData : {};
    section.content.push({
        id: 'control_prev_info',
        element: 'input',
        type: 'text',
        label: self.t('ACTION_CONTROL_PREV'),
        value: self.t('FIELD_PREV_DOC'),
        attributes: [{ readonly: true }],
        visibleIf: { field: 'actionType', value: 'control_prev' }
    });
    section.content.push({
        id: 'volume_step_up',
        element: 'input',
        type: 'number',
        label: self.t('FIELD_VOLUME_STEP'),
        doc: self.t('FIELD_VOLUME_STEP_UP_DOC'),
        value: actionKey === 'control_volume_up' ? (controlData.step ?? Controls.DEFAULT_STEP) : Controls.DEFAULT_STEP,
        visibleIf: { field: 'actionType', value: 'control_volume_up' }
    });
    section.content.push({
        id: 'volume_step_down',
        element: 'input',
        type: 'number',
        label: self.t('FIELD_VOLUME_STEP'),
        doc: self.t('FIELD_VOLUME_STEP_DOWN_DOC'),
        value: actionKey === 'control_volume_down' ? (controlData.step ?? Controls.DEFAULT_STEP) : Controls.DEFAULT_STEP,
        visibleIf: { field: 'actionType', value: 'control_volume_down' }
    });
    section.content.push({
        id: 'volume_value',
        element: 'input',
        type: 'number',
        label: self.t('FIELD_VOLUME_VALUE'),
        value: actionKey === 'control_volume_set' ? (controlData.value ?? Controls.DEFAULT_VOLUME) : Controls.DEFAULT_VOLUME,
        visibleIf: { field: 'actionType', value: 'control_volume_set' }
    });

    section.content.push({
        id: 'delete_tag_button',
        element: 'button',
        label: self.t('BUTTON_DELETE_TAG'),
        onClick: {
            type: 'controller',
            endpoint: ENDPOINT,
            method: 'deleteCurrentTag'
        }
    });
};


// ===========================================================
// ACTIES VANUIT DE UI
// ===========================================================

NfcMusic.prototype.editLastScanned = function () {
    var self = this;

    if (!self.activeTag) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_NO_TAG_SCANNED'));
        return libQ.resolve({});
    }

    self.activeEditTag = self.activeTag;
    return self.refreshUI();
};

NfcMusic.prototype.selectTagToEdit = function (data) {
    var self = this;

    var uid = (data.existingTagUid && data.existingTagUid.value)
        ? data.existingTagUid.value
        : data.existingTagUid;

    if (!uid) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_NO_TAG_SELECTED'));
        return libQ.resolve({});
    }

    self.activeEditTag = uid;
    return self.refreshUI();
};

NfcMusic.prototype.saveTag = async function (data) {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        self.logger.error('saveTag: no activeEditTag set');
        self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_NOTHING_TO_SAVE'));
        return {};
    }

    if (self.uiBusy) {
        self.logger.warn('saveTag blocked (UI busy)');
        return {};
    }
    self.uiBusy = true;

    try {
        var actionType = (data.actionType && data.actionType.value) ? data.actionType.value : data.actionType;
        var action = self.buildActionFromForm(actionType, data);

        if (!action) {
            self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_UNKNOWN_ACTION_TYPE', { type: actionType }));
            return {};
        }

        self.tags[uid] = {
            name: (data.name || uid).trim(),
            actions: [action]
        };

        self.saveTags();

        self.commandRouter.pushToastMessage('success', 'NFC Music', self.t('TOAST_SAVED', { uid: uid }));

        await self.refreshUI();

    } catch (err) {
        self.logger.error('saveTag error: ' + err);
        self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_SAVE_FAILED', { error: self.errorText(err) }));
    } finally {
        self.uiBusy = false;
    }

    return {};
};

NfcMusic.prototype.deleteCurrentTag = async function () {
    var self = this;
    var uid = self.activeEditTag;

    if (!uid) {
        self.commandRouter.pushToastMessage('error', 'NFC Music', self.t('TOAST_NOTHING_TO_DELETE'));
        return {};
    }

    delete self.tags[uid];
    self.saveTags();
    self.activeEditTag = null;

    self.commandRouter.pushToastMessage('success', 'NFC Music', self.t('TOAST_DELETED', { uid: uid }));

    await self.refreshUI();
    return {};
};


// ===========================================================
// HELPERS
// ===========================================================

/*
 * Zet een (source, type) combinatie om naar de dropdown-waarde,
 * bijv. { type: 'album', source: 'local' } -> 'local_album'
 */
NfcMusic.prototype.combinedActionTypeKey = function (action) {
    if (!action) {
        return 'local_album';
    }
    if (action.action === 'control') {
        return 'control_' + action.command;
    }
    var source = action.source || 'local';
    var type = action.type || 'album';
    return source + '_' + type;
};

/*
 * Bouwt het actions[0]-object precies zoals tag-handler.js het verwacht,
 * op basis van de dropdown-waarde en de bijbehorende formuliervelden.
 */
NfcMusic.prototype.buildActionFromForm = function (actionType, data) {
    if (typeof actionType === 'string' && actionType.indexOf('control_') === 0) {
        var command = actionType.substring('control_'.length);
        if (Controls.COMMANDS.indexOf(command) === -1) {
            return null;
        }
        var controlData = {};
        if (command === 'volume_up') {
            controlData.step = toIntInRange(data.volume_step_up, 1, 100, Controls.DEFAULT_STEP);
        } else if (command === 'volume_down') {
            controlData.step = toIntInRange(data.volume_step_down, 1, 100, Controls.DEFAULT_STEP);
        } else if (command === 'volume_set') {
            controlData.value = toIntInRange(data.volume_value, 0, 100, Controls.DEFAULT_VOLUME);
        }
        return { action: 'control', command: command, data: controlData };
    }

    switch (actionType) {

        case 'local_track':
            return {
                action: 'play',
                type: 'track',
                source: 'local',
                data: {
                    uri: (data.track_uri || '').trim(),
                    title: (data.track_titel || '').trim(),
                    artist: (data.track_artist || '').trim(),
                    album: (data.track_album || '').trim()
                }
            };

        case 'local_album':
            return {
                action: 'play',
                type: 'album',
                source: 'local',
                data: {
                    artist: (data.album_artist || '').trim(),
                    album: (data.album_naam || '').trim()
                }
            };

        case 'local_playlist':
            return {
                action: 'play',
                type: 'playlist',
                source: 'local',
                data: {
                    name: (data.playlist_naam || '').trim()
                }
            };

        default:
            return null;
    }
};

// =========================================================
// UI ACTION HANDLERS (called from frontend buttons)
// =========================================================

/*
 * getConfigurationFiles()
 * ---------------------------------------------------------
 * Definieert welke config files Volumio moet laden.
 * Altijd laten staan. Verplichte lifecycle hook. 
 */
NfcMusic.prototype.getConfigurationFiles = function () {
    return ['config.json'];
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


// Getal uit een formulierveld, begrensd; ongeldig -> standaardwaarde.
function toIntInRange(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, n));
}
