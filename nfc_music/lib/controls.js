'use strict';

/*
 * Bedieningstags: play/pauze, volgende, begin nummer / vorige, volume +/-
 * en een vaste volumewaarde.
 *
 * Gebruikt Volumio's commandRouter direct: de plugin draait in hetzelfde
 * Node-proces als Volumio, dus geen HTTP-rondje via 127.0.0.1:3000 nodig.
 *
 * Schema in tags.json:
 *   { "action": "control", "command": "<COMMANDS>", "data": { "step": 5 } | { "value": 20 } | {} }
 */

const DEFAULT_STEP = 5;
const DEFAULT_VOLUME = 20;
const COMMANDS = ['toggle', 'next', 'prev', 'volume_up', 'volume_down', 'volume_set'];

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function toInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

class Controls {
    constructor(commandRouter, logger) {
        this.commandRouter = commandRouter;
        this.logger = logger;
    }

    // commandRouter geeft soms een kew-promise, soms een waarde terug.
    async getState() {
        return (await Promise.resolve(this.commandRouter.volumioGetState())) || {};
    }

    async run(action) {
        const command = action && action.command;
        const data = (action && action.data) || {};

        switch (command) {
            case 'toggle':
                this.logger.info('NFC Music: play/pause');
                return this.commandRouter.volumioToggle();

            case 'next':
                this.logger.info('NFC Music: next track');
                return this.commandRouter.volumioNext();

            case 'prev':
                // Volumio's previous() werkt al als een cd-speler: eerste keer naar
                // het begin van het nummer, nog een keer binnen 3 s = vorig nummer
                // (statemachine.js: previousTrackonPrev). Een eigen seek(0) zou die
                // timer omzeilen en 'vorig nummer' onbereikbaar maken.
                this.logger.info('NFC Music: restart track / previous track');
                return this.commandRouter.volumioPrevious();

            case 'volume_up':
                return this.changeVolume(+clamp(toInt(data.step, DEFAULT_STEP), 1, 100));

            case 'volume_down':
                return this.changeVolume(-clamp(toInt(data.step, DEFAULT_STEP), 1, 100));

            case 'volume_set':
                return this.setVolume(toInt(data.value, DEFAULT_VOLUME));

            default:
                throw new Error(`Unknown control command: ${command}`);
        }
    }

    async changeVolume(delta) {
        const state = await this.getState();
        return this.setVolume(toInt(state.volume, 0) + delta);
    }

    async setVolume(volume) {
        const target = clamp(volume, 0, 100);
        this.logger.info(`NFC Music: volume -> ${target}`);
        return this.commandRouter.volumiosetvolume(target);
    }
}

module.exports = Controls;
module.exports.DEFAULT_STEP = DEFAULT_STEP;
module.exports.DEFAULT_VOLUME = DEFAULT_VOLUME;
module.exports.COMMANDS = COMMANDS;
