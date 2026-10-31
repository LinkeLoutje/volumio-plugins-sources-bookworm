'use strict';

const pcsclite = require('pcsclite');

/*
 * NFC-lezer via PC/SC (pcscd).
 *
 * - Bij een PC/SC-fout wordt de verbinding opnieuw opgebouwd (5 s, verdubbelend tot 60 s).
 * - Is er 10 s na het starten nog geen lezer, dan komt er één waarschuwing in de log.
 *   De verbinding blijft open: een lezer die later verschijnt (stekker erin) wordt dan
 *   meteen gemeld.
 * - stop() sluit lezers en verbinding en haalt alle luisteraars weg, zodat een oude
 *   plugin-instantie na een herstart geen scans meer ontvangt.
 */
const READER_WARN_MS = 10000;
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;

// APDU "Get Data" (PC/SC part 3): UID van de kaart
const GET_UID = [0xff, 0xca, 0x00, 0x00, 0x00];

function hex(buffer) {
    return Buffer.from(buffer).toString('hex').toUpperCase();
}

/*
 * Haalt de UID uit een antwoord (data + 2 statusbytes).
 * Geeft { uid } bij succes, { retryLe } als de lezer om een andere lengte vraagt (6C xx),
 * of { error } met de statusbytes.
 */
function parseUidResponse(data) {
    if (!data || data.length < 2) {
        return { error: `response too short (${data ? hex(data) : 'empty'})` };
    }
    const sw1 = data[data.length - 2];
    const sw2 = data[data.length - 1];
    if (sw1 === 0x6c) {
        return { retryLe: sw2 };
    }
    if (sw1 !== 0x90 || sw2 !== 0x00) {
        return { error: `status bytes ${hex([sw1, sw2])}` };
    }
    const uid = hex(data.slice(0, -2));
    if (!uid) {
        return { error: 'empty UID (status bytes 9000)' };
    }
    return { uid };
}

class NfcReader {

    constructor(options = {}) {
        this.logger = options.logger || { info() {}, warn() {}, error() {} };
        this.onTag = options.onTag || (() => {});

        this.pcsc = null;
        this.readers = new Set();
        this.stopped = true;
        this.warnTimer = null;
        this.retryTimer = null;
        this.retryDelay = RETRY_MIN_MS;
    }

    start() {
        this.stopped = false;
        this._connect();
        // onStart hoeft niet te wachten tot er een lezer is.
        return Promise.resolve();
    }

    stop() {
        this.logger.info('NFC: stopping reader');
        this.stopped = true;
        this._clearTimers();
        this._closePcsc();
    }

    _connect() {
        if (this.stopped) {
            return;
        }
        this.logger.info('NFC: initialising PC/SC');

        try {
            this.pcsc = pcsclite();
        } catch (err) {
            this.logger.error(`NFC PC/SC error: ${err.message}`);
            this._scheduleReconnect();
            return;
        }

        const pcsc = this.pcsc;
        pcsc.on('reader', reader => {
            if (this.stopped || pcsc !== this.pcsc) {
                return;   // melding van een oude verbinding
            }
            this._onReader(reader);
        });
        pcsc.on('error', err => {
            if (this.stopped || pcsc !== this.pcsc) {
                return;   // bijv. "Command cancelled" na ons eigen close()
            }
            this.logger.error(`NFC PC/SC error: ${err.message}`);
            this._scheduleReconnect();
        });

        this._clearWarnTimer();
        this.warnTimer = setTimeout(() => {
            this.warnTimer = null;
            if (!this.stopped && this.readers.size === 0) {
                this.logger.warn('NFC: no reader found. Check the USB connection; ' +
                    'if it does not work after a restart, unplug the reader and plug it in again.');
            }
        }, READER_WARN_MS);
    }

    _onReader(reader) {
        this.readers.add(reader);
        this.retryDelay = RETRY_MIN_MS;
        this._clearWarnTimer();
        this.logger.info(`NFC: reader found: ${reader.name}`);

        reader.on('error', err => {
            this.logger.error(`NFC reader error: ${err.message}`);
        });

        reader.on('status', status => {
            if (this.stopped) {
                return;
            }
            const changes = reader.state ^ status.state;
            if (!changes) {
                return;
            }
            if ((changes & reader.SCARD_STATE_PRESENT) && (status.state & reader.SCARD_STATE_PRESENT)) {
                this.logger.info('NFC: tag detected');
                this._readUid(reader);
            }
            if ((changes & reader.SCARD_STATE_EMPTY) && (status.state & reader.SCARD_STATE_EMPTY)) {
                this.logger.info('NFC: tag removed');
            }
        });

        reader.on('end', () => {
            this.logger.info(`NFC: reader removed: ${reader.name}`);
            this.readers.delete(reader);
        });
    }

    _scheduleReconnect() {
        if (this.stopped || this.retryTimer) {
            return;
        }
        this._clearWarnTimer();
        this._closePcsc();

        const delay = this.retryDelay;
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
        this.logger.info(`NFC: reconnecting in ${delay / 1000} s`);

        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this._connect();
        }, delay);
    }

    _closePcsc() {
        for (const reader of this.readers) {
            try {
                reader.removeAllListeners();
                if (typeof reader.close === 'function') {
                    reader.close();
                }
            } catch (err) {
                this.logger.warn(`NFC: closing reader failed: ${err.message}`);
            }
        }
        this.readers.clear();

        if (this.pcsc) {
            const pcsc = this.pcsc;
            this.pcsc = null;
            try {
                pcsc.removeAllListeners();
                pcsc.on('error', () => {});   // late fouten van de gesloten verbinding negeren
                pcsc.close();
            } catch (err) {
                this.logger.warn(`NFC: closing PC/SC failed: ${err.message}`);
            }
        }
    }

    _clearWarnTimer() {
        if (this.warnTimer) {
            clearTimeout(this.warnTimer);
            this.warnTimer = null;
        }
    }

    _clearTimers() {
        this._clearWarnTimer();
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }

    _readUid(reader) {
        reader.connect({ share_mode: reader.SCARD_SHARE_SHARED }, (err, protocol) => {
            if (err) {
                this.logger.error(`NFC connect error: ${err.message}`);
                return;
            }

            const disconnect = () => {
                reader.disconnect(reader.SCARD_LEAVE_CARD, disconnectError => {
                    if (disconnectError) {
                        this.logger.error(`NFC disconnect error: ${disconnectError.message}`);
                    }
                });
            };

            const send = (apdu, retriesLeft) => {
                reader.transmit(Buffer.from(apdu), 40, protocol, (err, data) => {
                    if (err) {
                        this.logger.error(`NFC: reading UID failed: ${err.message}`);
                        disconnect();
                        return;
                    }

                    const result = parseUidResponse(data);

                    if (result.retryLe !== undefined && retriesLeft > 0) {
                        // Lezer vraagt een andere lengte (6C xx): opnieuw met Le = xx
                        send(GET_UID.slice(0, 4).concat([result.retryLe]), retriesLeft - 1);
                        return;
                    }

                    if (result.uid) {
                        this.logger.info(`NFC UID: ${result.uid}`);
                        if (!this.stopped) {
                            Promise.resolve(this.onTag(result.uid)).catch(error => {
                                this.logger.error(`NFC tag handler error: ${error.message}`);
                            });
                        }
                    } else {
                        this.logger.error(`NFC: reading UID failed: ${result.error || 'unknown response'} ` +
                            `(response ${data ? hex(data) : 'empty'})`);
                    }
                    disconnect();
                });
            };

            send(GET_UID, 1);
        });
    }
}

module.exports = NfcReader;
module.exports.parseUidResponse = parseUidResponse;
