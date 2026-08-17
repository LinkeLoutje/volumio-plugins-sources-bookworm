'use strict';

const NfcReader = require('./lib/nfc-reader');

const reader = new NfcReader({
    onTag: async (uid) => {
        console.log('>>> TAG CALLBACK:', uid);
    }
});

reader.start()
    .then(() => {
        console.log('NFC reader gestart');
    })
    .catch(err => {
        console.error('NFC reader starten mislukt:', err);
        process.exit(1);
    });

process.on('SIGINT', () => {
    console.log('\nNFC reader stoppen...');
    reader.stop();
    process.exit(0);
});
