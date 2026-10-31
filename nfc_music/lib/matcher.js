'use strict';

const { PluginError } = require('./errors');

/*
 * Zoekresultaten van Volumio koppelen aan wat er in een tag staat.
 * Pure functies (geen I/O), zodat ze los te testen zijn: zie test/matcher.test.js.
 *
 * Regels:
 * 1. Vergelijken gebeurt op genormaliseerde tekst: hoofdletters, accenten en
 *    leestekens tellen niet mee. Letters en cijfers uit elk schrift blijven staan
 *    (Cyrillisch, Grieks, Japans, ...).
 * 2. Rangorde, de eerste niveau dat iets oplevert wint:
 *      a. titel exact + artiest exact
 *      b. één van de twee gedeeltelijk (op hele woorden), de ander exact:
 *         "Queen" in "Queen & David Bowie", of "Royals" in "Royals (Live)".
 *         Deze twee gevallen zijn gelijkwaardig: komen ze allebei voor, dan
 *         is het niet eenduidig en kiest de gebruiker met het album.
 *      c. titel en artiest allebei gedeeltelijk
 *    Een volledig exacte match wint dus altijd. "The" vooraan de artiest telt niet mee.
 * 3. Album (bij een los nummer) maakt de keuze nauwer als het iets oplevert;
 *    sluit het alles uit (bv. een tikfout), dan wordt het genegeerd.
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

// kind: 'TRACK' of 'ALBUM' (deel van de foutcode, bijv. ERR_TRACK_NOT_FOUND)
function pickOne(candidates, kind, wanted) {
    if (candidates.length === 1) {
        return candidates[0];
    }
    if (candidates.length === 0) {
        throw new PluginError(`${kind}_NOT_FOUND`, { wanted });
    }
    const names = candidates.slice(0, 3).map(describe).join(' | ');
    throw new PluginError(`${kind}_AMBIGUOUS`, { count: candidates.length, names });
}

// "The Beatles" == "Beatles"
function normalizeArtist(value) {
    return normalize(value).replace(/^the /, '');
}

const exact = (have, want) => have === want;
const words = (have, want) => containsWords(have, want);

// Niveaus in volgorde van voorkeur; elk niveau is een lijst van
// gelijkwaardige [titel-vergelijking, artiest-vergelijking]-paren.
const TIERS = [
    [[exact, exact]],
    [[exact, words], [words, exact]],
    [[words, words]]
];

function bestTier(candidates, wantedTitle, wantedArtist, ignoreArtist) {
    for (const tier of TIERS) {
        const found = candidates.filter(c => tier.some(([titleCmp, artistCmp]) =>
            titleCmp(c.title, wantedTitle) &&
            (!wantedArtist || ignoreArtist || artistCmp(c.artist, wantedArtist))
        ));
        if (found.length > 0) {
            return found;
        }
    }
    return [];
}

/*
 * lists:  searchResponse.data.navigation.lists van /api/v1/search
 * wanted: { title, artist?, album? }
 */
function findTrack(lists, wanted) {
    const title = normalize(wanted && wanted.title);
    const artist = normalizeArtist(wanted && wanted.artist);
    const album = normalize(wanted && wanted.album);
    const label = [wanted && wanted.artist, wanted && wanted.title].filter(Boolean).join(' - ');

    if (!title) {
        throw new PluginError('INVALID_TITLE', { value: wanted && wanted.title });
    }

    const songs = flattenItems(lists, ['song']).map(item => ({
        item,
        title: normalize(item.title),
        artist: normalizeArtist(item.artist),
        album: normalize(item.album)
    }));

    let candidates = bestTier(songs, title, artist, false);

    if (album && candidates.length > 1) {
        const byAlbumExact = candidates.filter(c => c.album === album);
        const byAlbumWords = candidates.filter(c => containsWords(c.album, album));
        if (byAlbumExact.length > 0) {
            candidates = byAlbumExact;
        } else if (byAlbumWords.length > 0) {
            candidates = byAlbumWords;
        }
    }

    return pickOne(candidates.map(c => c.item), 'TRACK', label);
}

/*
 * wanted: { album, artist? }
 * Volumio geeft albums terug als type 'folder' (of 'album') met title = albumnaam
 * en meestal een artist-veld.
 */
function findAlbum(lists, wanted) {
    const albumName = normalize(wanted && wanted.album);
    const artist = normalizeArtist(wanted && wanted.artist);
    const label = [wanted && wanted.artist, wanted && wanted.album].filter(Boolean).join(' - ');

    if (!albumName) {
        throw new PluginError('INVALID_ALBUM', { value: wanted && wanted.album });
    }

    const albums = flattenItems(lists, ['folder', 'album']).map(item => ({
        item,
        title: normalize(item.title),
        artist: normalizeArtist(item.artist)
    }));

    // Geeft deze Volumio-versie geen artiest bij albums mee, dan kunnen we er
    // niet op filteren; de eenduidigheidscheck voorkomt dan alsnog dat een
    // willekeurig album met dezelfde titel start.
    const ignoreArtist = !albums.some(a => a.artist);

    const candidates = bestTier(albums, albumName, artist, ignoreArtist);
    return pickOne(candidates.map(a => a.item), 'ALBUM', label);
}

module.exports = { normalize, normalizeArtist, findTrack, findAlbum };
