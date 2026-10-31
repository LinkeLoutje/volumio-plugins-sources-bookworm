# Changelog

## [Unreleased]
### Fixed
- After restarting the plugin, an old instance could still receive scans ("Controls not available").
  Readers and listeners are now cleaned up on stop, and a stopped plugin ignores scans.
- The response to the UID command is now checked: status bytes must be `90 00`, an empty UID is rejected,
  and a "wrong length" answer (`6C xx`) is retried with the requested length.
- The plugin reconnects to PC/SC only after a real PC/SC error; without a reader it logs one warning and
  keeps the connection open, so a reader that is plugged in later is detected immediately.
- Removed a leftover debug log line.

### Removed
- Spotify support (never functional): Volumio only acts as a Spotify Connect receiver and cannot start a
  Spotify URI itself. Existing Spotify tags now show a clear "Spotify is not supported" message.
- `amd64` from the supported architectures: the plugin uses a native module (`pcsclite`) and is only
  built and tested on a Raspberry Pi 4 (armhf).

### Added
- Control tags: play/pause, next track, restart/previous track, volume up/down (step size per tag,
  default 5) and a fixed volume (default 20).
- Duplicate scans of the same tag within 1.2 s are ignored.
- Translations for new strings in `i18n/strings_en.json` and `i18n/strings_nl.json`.

### Fixed
- Tracks and albums are matched safely: exact match on title + artist (+ album) first, whole-word
  partial match only as a fallback, and an error instead of a guess when several results remain.
  Works with accents and non-Latin scripts (Cyrillic, Greek, ...); album matching now uses the artist.
- Tags with a stored track URI play that exact file again.
- Volumio API calls time out after 8 seconds.

### Changed
- Tags are stored in `/data/configuration/system_hardware/nfc_music/tags.json` and survive plugin updates
  (automatic migration from the old location).
- `install.sh` installs `pcscd`/`libccid`, enables `pcscd.socket` and blacklists the kernel `pn533` drivers;
  the install state is recorded (and kept across updates) so `uninstall.sh` reverts exactly these changes.
- Removed unused dependencies (`fs-extra`, `v-conf`).

## [2.0.0]
- Configuration page: last scanned tag, pick an existing tag, edit/delete a tag.
- Play local albums and tracks via the Volumio REST API.
