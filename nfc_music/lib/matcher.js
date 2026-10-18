'use strict';

/*
 * Zoekresultaten van Volumio koppelen aan wat er in een tag staat.
 * Pure functies (geen I/O), zodat ze los te testen zijn: zie test/matcher.test.js.
 *
 * Regels:
 * 1. Vergelijken gebeurt op genormaliseerde tekst: hoofdletters, accenten en
 *    leestekens tellen niet mee. Letters en cijfers uit elk schrift blijven staan
 *    (Cyrillisch, Grieks, Japans, ...).
 * 2. Eerst exacte matches op titel + artiest (+ album als dat is ingevuld).
 * 3. Pas als er geen exacte match is: gedeeltelijke match op hele woorden,
 *    alleen voor de titel/albumnaam. De artiest moet altijd exact kloppen
 *    (anders matcht "Lorde" ook "Lorde Tribute Band").
 * 4. Blijft er meer dan één kandidaat over, dan wordt er NIETS gestart maar
 *    een duidelijke fout gegeven. Liever geen muziek dan de verkeerde.
 */

function normalize(value) {
    return String(value == null ? '' : value)
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')          // accenten (combining marks) weg
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')  // alles behalve letters/cijfers -> spatie
        .trim();
}

// "love" zit als heel woord in "love me do", maar niet in "lovely day"
function containsWords(haystack, needle) {
    if (!needle) {
        return false;
    }
    return (' ' + haystack + ' ').includes(' ' + needle + ' ');
}

function uniqueByUri(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.uri || JSON.stringify(item);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function flattenItems(lists, types) {
    const all = [];
    for (const list of lists || []) {
        for (const item of (list && list.items) || []) {
            if (item && types.includes(item.type)) {
                all.push(item);
            }
        }
    }
    return uniqueByUri(all);
}

function describe(item) {
    return [item.artist, item.album, item.title].filter(Boolean).join(' - ');
}

function pickOne(candidates, what, wanted) {
    if (candidates.length === 1) {
        return candidates[0];
    }
    if (candidates.length === 0) {
        throw new Error(`${what} niet gevonden: ${wanted}`);
    }
    const names = candidates.slice(0, 3).map(describe).join(' | ');
    throw new Error(
        `${what} niet eenduidig (${candidates.length} kandidaten: ${names}). ` +
        'Vul artiest en/of album in om te kiezen.'
    );
}

/*
 * lists:  searchResponse.data.navigation.lists van /api/v1/search
 * wanted: { title, artist?, album? }
 */
function findTrack(lists, wanted) {
    const title = normalize(wanted && wanted.title);
    const artist = normalize(wanted && wanted.artist);
    const album = normalize(wanted && wanted.album);
    const label = [wanted && wanted.artist, wanted && wanted.title].filter(Boolean).join(' - ');

    if (!title) {
        throw new Error(`Ongeldige titel: "${wanted && wanted.title}"`);
    }

    const songs = flattenItems(lists, ['song']).map(item => ({
        item,
        title: normalize(item.title),
        artist: normalize(item.artist),
        album: normalize(item.album)
    }));

    const narrowByAlbum = candidates => {
        if (!album) {
            return candidates;
        }
        return candidates.filter(c => c.album === album);
    };

    // 1. exact
    let candidates = songs.filter(c =>
        c.title === title && (!artist || c.artist === artist)
    );
    candidates = narrowByAlbum(candidates);

    // 2. gedeeltelijk (hele woorden), alleen als er geen exacte match is
    if (candidates.length === 0) {
        candidates = songs.filter(c =>
            containsWords(c.title, title) &&
            (!artist || c.artist === artist)
        );
        candidates = narrowByAlbum(candidates);
    }

    return pickOne(candidates.map(c => c.item), 'Nummer', label);
}

/*
 * wanted: { album, artist? }
 * Volumio geeft albums terug als type 'folder' (of 'album') met title = albumnaam
 * en meestal een artist-veld.
 */
function findAlbum(lists, wanted) {
    const albumName = normalize(wanted && wanted.album);
    const artist = normalize(wanted && wanted.artist);
    const label = [wanted && wanted.artist, wanted && wanted.album].filter(Boolean).join(' - ');

    if (!albumName) {
        throw new Error(`Ongeldige albumnaam: "${wanted && wanted.album}"`);
    }

    const albums = flattenItems(lists, ['folder', 'album']).map(item => ({
        item,
        title: normalize(item.title),
        artist: normalize(item.artist)
    }));

    // Geeft deze Volumio-versie geen artiest bij albums mee, dan kunnen we er
    // niet op filteren; de eenduidigheidscheck hieronder voorkomt dan alsnog
    // dat een willekeurig album met dezelfde titel start.
    const resultsHaveArtist = albums.some(a => a.artist);
    const artistOk = a => !artist || !resultsHaveArtist || a.artist === artist;

    let candidates = albums.filter(a => a.title === albumName && artistOk(a));

    if (candidates.length === 0) {
        candidates = albums.filter(a => containsWords(a.title, albumName) && artistOk(a));
    }

    return pickOne(candidates.map(a => a.item), 'Album', label);
}

module.exports = { normalize, findTrack, findAlbum };
