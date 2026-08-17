'use strict';

const pcsclite = require('pcsclite');

console.log('PC/SC test gestart...');

const pcsc = pcsclite();

pcsc.on('reader', reader => {
    console.log('Reader gevonden:', reader.name);

    reader.on('error', err => {
        console.error('Reader error:', err.message);
    });

    reader.on('status', status => {
        console.log('Reader status:', status);

        const changes = reader.state ^ status.state;

        if (!changes) {
            return;
        }

        if ((changes & reader.SCARD_STATE_PRESENT) &&
            (status.state & reader.SCARD_STATE_PRESENT)) {

            console.log('NFC TAG GEDETECTEERD');

            reader.connect(
                { share_mode: reader.SCARD_SHARE_SHARED },
                (err, protocol) => {
                    if (err) {
                        console.error('Connect error:', err.message);
                        return;
                    }

                    console.log('Kaart verbonden, protocol:', protocol);

                    reader.transmit(
                        Buffer.from([
                            0xff, 0xca, 0x00, 0x00, 0x00
                        ]),
                        40,
                        protocol,
                        (err, data) => {

                            if (err) {
                                console.error(
                                    'UID uitlezen mislukt:',
                                    err.message
                                );
                            } else {
                                console.log(
                                    'UID:',
                                    data.slice(0, -2).toString('hex').toUpperCase()
                                );
                            }

                            reader.disconnect(
                                reader.SCARD_LEAVE_CARD,
                                err => {
                                    if (err) {
                                        console.error(
                                            'Disconnect error:',
                                            err.message
                                        );
                                    }
                                }
                            );
                        }
                    );
                }
            );
        }

        if ((changes & reader.SCARD_STATE_EMPTY) &&
            (status.state & reader.SCARD_STATE_EMPTY)) {

            console.log('NFC TAG VERWIJDERD');
        }
    });

    reader.on('end', () => {
        console.log('Reader verwijderd:', reader.name);
    });
});

pcsc.on('error', err => {
    console.error('PC/SC error:', err.message);
});
