'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, findTrack, findAlbum } = require('../lib/matcher');

const song = (artist, album, title, uri) =>
    ({ type: 'song', service: 'mpd', artist, album, title, uri: uri || `${artist}/${album}/${title}` });
const folder = (artist, title, uri) =>
    ({ type: 'folder', service: 'mpd', artist, title, uri: uri || `albums://${artist}/${title}` });
const lists = (...items) => [{ items }];

test('normalize: accenten, hoofdletters en leestekens', () => {
    assert.equal(normalize('Dominique Fils-Aimé'), 'dominique fils aime');
    assert.equal(normalize('  Stay Tuned!  '), 'stay tuned');
});

test('normalize: niet-Latijnse schriften blijven behouden', () => {
    assert.equal(normalize('Кино'), 'кино');
    assert.equal(normalize('Μίκης Θεοδωράκης'), 'μικης θεοδωρακης');
    assert.equal(normalize('坂本龍一'), '坂本龍一');
});

test('gewone titel', () => {
    const r = findTrack(lists(song('Queen', 'A Night at the Opera', 'Love of My Life')),
        { artist: 'Queen', title: 'Love of My Life' });
    assert.equal(r.title, 'Love of My Life');
});

test('titel met accenten, ingevoerd zonder accenten', () => {
    const r = findTrack(lists(song('Dominique Fils-Aimé', 'Stay Tuned!', 'Good Feeling')),
        { artist: 'dominique fils aime', title: 'good feeling' });
    assert.equal(r.artist, 'Dominique Fils-Aimé');
});

test('Cyrillische titel: juiste nummer, niet het eerste resultaat', () => {
    const r = findTrack(lists(
        song('Кино', 'Группа крови', 'Закрой за мной дверь'),
        song('Кино', 'Группа крови', 'Группа крови')),
        { artist: 'Кино', title: 'Группа крови' });
    assert.equal(r.title, 'Группа крови');
});

test('titel die na normaliseren leeg is wordt geweigerd', () => {
    assert.throws(() => findTrack(lists(song('X', 'Y', 'Z')), { title: '!!!' }), /Invalid title/);
});

test('exacte match gaat voor gedeeltelijke ("Love" vs "Lovely Day" / "Love (Live)")', () => {
    const r = findTrack(lists(
        song('Bill Withers', 'Menagerie', 'Lovely Day'),
        song('Artist', 'Live', 'Love (Live)'),
        song('Artist', 'Studio', 'Love')),
        { artist: 'Artist', title: 'Love' });
    assert.equal(r.album, 'Studio');
});

test('gedeeltelijke titel mag als die eenduidig is ("Hallelujah" -> "Hallelujah (Live)")', () => {
    const r = findTrack(lists(song('Jeff Buckley', 'Live at Sin-é', 'Hallelujah (Live)')),
        { artist: 'Jeff Buckley', title: 'Hallelujah' });
    assert.equal(r.title, 'Hallelujah (Live)');
});

test('"Love" matcht nooit "Lovely Day" (hele woorden)', () => {
    assert.throws(() => findTrack(lists(song('Bill Withers', 'Menagerie', 'Lovely Day')),
        { title: 'Love' }), /not found/);
});

test('twee nummers met dezelfde titel van verschillende artiesten: artiest beslist', () => {
    const items = lists(song('Leonard Cohen', 'Various Positions', 'Hallelujah'),
        song('Jeff Buckley', 'Grace', 'Hallelujah'));
    assert.equal(findTrack(items, { artist: 'Jeff Buckley', title: 'Hallelujah' }).album, 'Grace');
});

test('dezelfde titel zonder artiest: fout i.p.v. gokken', () => {
    const items = lists(song('Leonard Cohen', 'Various Positions', 'Hallelujah'),
        song('Jeff Buckley', 'Grace', 'Hallelujah'));
    assert.throws(() => findTrack(items, { title: 'Hallelujah' }), /ambiguous/);
});

test('zelfde nummer op album en verzamelalbum: album beslist, anders fout', () => {
    const items = lists(song('Queen', 'A Night at the Opera', 'Bohemian Rhapsody'),
        song('Queen', 'Greatest Hits', 'Bohemian Rhapsody'));
    assert.throws(() => findTrack(items, { artist: 'Queen', title: 'Bohemian Rhapsody' }), /ambiguous/);
    assert.equal(findTrack(items, { artist: 'Queen', title: 'Bohemian Rhapsody', album: 'greatest hits' }).album,
        'Greatest Hits');
});

test('exacte artiest wint van gedeeltelijke (Lorde vs Lorde Tribute Band)', () => {
    const items = lists(song('Lorde Tribute Band', 'Melodrama', 'Royals', 'tribute'),
        song('Lorde', 'Pure Heroine', 'Royals', 'lorde'));
    assert.equal(findTrack(items, { artist: 'Lorde', title: 'Royals' }).uri, 'lorde');
});

test('gedeeltelijke artiest als er niets beters is ("Queen" -> "Queen & David Bowie")', () => {
    const r = findTrack(lists(song('Queen & David Bowie', 'Hot Space', 'Under Pressure')),
        { artist: 'Queen', title: 'Under Pressure' });
    assert.equal(r.album, 'Hot Space');
});

test('"The" vooraan de artiest telt niet mee', () => {
    const r = findTrack(lists(song('The Beatles', 'Abbey Road', 'Come Together')),
        { artist: 'Beatles', title: 'Come Together' });
    assert.equal(r.album, 'Abbey Road');
});

test('verkeerd album ingevuld bij een eenduidig nummer: album wordt genegeerd', () => {
    const r = findTrack(lists(song('Queen', 'Jazz', "Don't Stop Me Now")),
        { artist: 'Queen', title: "Don't Stop Me Now", album: 'Jaz' });
    assert.equal(r.album, 'Jazz');
});

test('gedeeltelijke artiest en gedeeltelijke titel zijn gelijkwaardig: fout, album beslist', () => {
    const items = lists(song('Lorde Tribute Band', 'Covers', 'Royals', 'tribute'),
        song('Lorde', 'Live in Auckland', 'Royals (Live)', 'live'));
    assert.throws(() => findTrack(items, { artist: 'Lorde', title: 'Royals' }), /ambiguous/);
    assert.equal(findTrack(items, { artist: 'Lorde', title: 'Royals', album: 'Live in Auckland' }).uri, 'live');
});

test('hetzelfde resultaat in meerdere lijsten telt als één', () => {
    const s = song('Queen', 'Jazz', "Don't Stop Me Now");
    const r = findTrack([{ items: [s] }, { items: [{ ...s }] }], { title: "Don't stop me now" });
    assert.equal(r.uri, s.uri);
});

test('album: gedeeltelijke artiest als er niets beters is', () => {
    const r = findAlbum(lists(folder('Simon & Garfunkel', 'Bookends')), { artist: 'Simon', album: 'Bookends' });
    assert.equal(r.artist, 'Simon & Garfunkel');
});

test('album: zelfde titel bij meerdere artiesten, artiest beslist', () => {
    const items = lists(folder('Weezer', 'Weezer'), folder('Peter Gabriel', 'Greatest Hits'),
        folder('Queen', 'Greatest Hits'));
    assert.equal(findAlbum(items, { artist: 'Queen', album: 'Greatest Hits' }).artist, 'Queen');
    assert.throws(() => findAlbum(items, { album: 'Greatest Hits' }), /ambiguous/);
});

test('album met accenten', () => {
    const r = findAlbum(lists(folder('Dominique Fils-Aimé', 'Stay Tuned!')),
        { artist: 'Dominique Fils-Aime', album: 'stay tuned' });
    assert.equal(r.title, 'Stay Tuned!');
});

test('album zonder artiest-veld in zoekresultaten: alleen bij één kandidaat', () => {
    const one = lists({ type: 'folder', title: 'Grace', uri: 'a' });
    assert.equal(findAlbum(one, { artist: 'Jeff Buckley', album: 'Grace' }).uri, 'a');
    const two = lists({ type: 'folder', title: 'Grace', uri: 'a' }, { type: 'folder', title: 'Grace', uri: 'b' });
    assert.throws(() => findAlbum(two, { artist: 'Jeff Buckley', album: 'Grace' }), /ambiguous/);
});
